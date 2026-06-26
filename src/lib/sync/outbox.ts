/**
 * The local outbox: every persisted change appends a row here so the flusher has
 * a single queue to drain, without adding sync columns to every entity. Enqueueing
 * is a no-op when Google is not configured, so the offline/local-only build never
 * touches this store. A tiny pub-sub lets the sync engine flush soon after a write.
 */
import { db } from '../storage/db'
import { isGoogleConfigured } from '../google/auth'
import { now } from '../util'
import type { OutboxRow, SyncOp, SyncTable } from './types'
import { SYNC_TABLES } from './types'

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribe to enqueue events (engine uses this to debounce a flush). */
export function onEnqueue(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function notify(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* a listener error must not block the write */
    }
  }
}

interface Trackable {
  id: string
  project_id?: string
  updated_at?: string
  created_at?: string
}

async function enqueue(
  table: SyncTable,
  op: SyncOp,
  recordId: string,
  projectId: string,
  updatedAt: string,
  data?: unknown,
): Promise<void> {
  if (!isGoogleConfigured()) return
  await db.outbox.add({ table, op, recordId, project_id: projectId, updated_at: updatedAt, data })
  notify()
}

/** Record a create/update for replication. `projects` are their own project. */
export async function trackUpsert(table: SyncTable, record: Trackable): Promise<void> {
  const projectId = table === 'projects' ? record.id : (record.project_id ?? '')
  const updatedAt = record.updated_at ?? record.created_at ?? now()
  await enqueue(table, 'upsert', record.id, projectId, updatedAt, record)
}

/** Record a deletion (a tombstone) for replication. */
export async function trackDelete(
  table: SyncTable,
  recordId: string,
  projectId: string,
): Promise<void> {
  await enqueue(table, 'delete', recordId, projectId, now())
}

/** All pending rows, oldest first (flush applies them in order). */
export async function allRows(): Promise<OutboxRow[]> {
  return db.outbox.orderBy('seq').toArray()
}

/** Drop drained rows after a successful flush. */
export async function removeRows(seqs: number[]): Promise<void> {
  await db.outbox.bulkDelete(seqs)
}

/** `table/recordId` keys with a pending change — merge must never clobber these. */
export async function dirtyKeys(): Promise<Set<string>> {
  const rows = await db.outbox.toArray()
  return new Set(rows.map((r) => `${r.table}/${r.recordId}`))
}

/**
 * Re-enqueue every record of a project as an upsert. Used when a project moves to
 * a new scope (e.g. into a team) so all its existing data flushes to the new
 * scope's folder, where teammates can pull it.
 */
export async function reenqueueProject(projectId: string): Promise<void> {
  if (!isGoogleConfigured()) return
  const proj = await db.projects.get(projectId)
  if (proj) await trackUpsert('projects', proj)
  const byProject = (rows: Trackable[]) => rows
  for (const ft of byProject(await db.focusTexts.where('project_id').equals(projectId).toArray()))
    await trackUpsert('focusTexts', ft)
  for (const g of byProject(await db.genres.where('project_id').equals(projectId).toArray()))
    await trackUpsert('genres', g)
  for (const w of byProject(await db.worksheets.where('project_id').equals(projectId).toArray()))
    await trackUpsert('worksheets', w)
  for (const n of byProject(await db.capturedNotes.where('project_id').equals(projectId).toArray()))
    await trackUpsert('capturedNotes', n)
  for (const e of byProject(await db.entries.where('project_id').equals(projectId).toArray()))
    await trackUpsert('entries', e)
}

/**
 * One-time upload of pre-existing local data: on first sign-in, enqueue every
 * record so work created before sync existed is mirrored to the cloud too.
 */
export async function backfillAll(): Promise<void> {
  if (!isGoogleConfigured()) return
  const flag = await db.meta.get('syncBackfilled')
  if (flag?.value === '1') return

  const loaders: Record<SyncTable, () => Promise<Trackable[]>> = {
    projects: () => db.projects.toArray(),
    focusTexts: () => db.focusTexts.toArray(),
    genres: () => db.genres.toArray(),
    worksheets: () => db.worksheets.toArray(),
    capturedNotes: () => db.capturedNotes.toArray(),
    entries: () => db.entries.toArray(),
  }
  for (const table of SYNC_TABLES) {
    const rows = await loaders[table]()
    for (const r of rows) await trackUpsert(table, r)
  }
  await db.meta.put({ key: 'syncBackfilled', value: '1' })
}
