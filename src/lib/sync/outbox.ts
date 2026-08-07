/**
 * The local outbox: every persisted change appends a row here so the pusher has
 * a single queue to drain, without adding sync columns to every entity. Enqueueing
 * is a no-op when Supabase is not configured, so a fully local build never touches
 * this store. A tiny pub-sub lets the sync engine push soon after a write.
 *
 * Rows are enqueued for EVERY project, including ones that are not published.
 * Filtering happens at push time (supabase/push.ts), which drops rows for
 * unsynced projects rather than retrying them forever against a server that
 * would silently discard them.
 */
import { db } from '../storage/db'
import { isSupabaseConfigured } from '../supabase/client'
import { now } from '../util'
import type { OutboxRow, SyncOp, SyncTable } from './types'

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
  if (!isSupabaseConfigured()) return
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

/** How many writes are waiting. Shown verbatim in the header, because a number
 *  can be checked and a green dot cannot. */
export async function pendingCount(): Promise<number> {
  return db.outbox.count()
}

/**
 * Re-enqueue every record of a project as an upsert, so everything already in
 * this browser reaches the cloud. Called when a project is published: work done
 * before sign-in is uploaded rather than stranded on the device.
 */
export async function reenqueueProject(projectId: string): Promise<void> {
  if (!isSupabaseConfigured()) return
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

// `backfillAll()` used to enqueue EVERY local record on first sign-in. It is gone
// on purpose: with per-project publishing, `reenqueueProject` at publish time is
// the scoped equivalent, and a blanket backfill would have uploaded local-only
// projects the user never chose to publish.
