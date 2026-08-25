/**
 * Last-write-wins merge of downloaded shards into the local Dexie store.
 *
 * Rules (in order):
 *  - Across all shards, the newest `updated_at` per `table/recordId` wins; ties
 *    break by `authorId` for determinism.
 *  - A record currently dirty in the local outbox is never overwritten — the
 *    local edit will flush and the global LWW resolves it next round. This is
 *    what keeps a pull from eating local unsynced edits.
 *  - capturedNotes are immutable provenance with exactly one sanctioned mutation,
 *    archive/restore. Deletes are still ignored. Precedence is PRESENCE-based:
 *    only archive/restore ever writes `updated_at` onto the row itself, so a row
 *    carrying it beats a plain row in both directions, and two carrying rows
 *    LWW between themselves. `updated_at` is never compared against
 *    `created_at` for this table — `created_at` came from the capturer's clock,
 *    which in a workshop room may run minutes fast, and that comparison would
 *    let an old-client replay resurrect an archived note (or stop an archive
 *    from ever propagating). `raw_text`/`created_at` are always pinned to the
 *    local copy, so the immutable half stays immutable even against a bad shard.
 *  - Row-order sidecars (`cell_key === '__rows'`) UNION instead of replacing, so
 *    two people adding a table row at once keep both rows rather than one
 *    silently losing theirs.
 *  - Otherwise a remote upsert applies only when strictly newer than the local
 *    row; a remote delete applies unless the local row is newer.
 *
 * A remote upsert that replaces different, non-empty local text also writes a
 * history row, so any loss last-write-wins causes stays recoverable from the
 * entry's history rather than being gone.
 */
import { db } from '../storage/db'
import { dirtyKeys } from './outbox'
import { emitOverwrite } from './notices'
import { myAuthorIds } from './identity'
import type { Shard, ShardRecord, SyncTable } from './types'
import type { CapturedNote, Entry } from '../types'

interface Timestamped {
  updated_at?: string
  created_at?: string
}
function ts(row: Timestamped | undefined): string {
  return row?.updated_at ?? row?.created_at ?? ''
}

type AnyTable = {
  get: (id: string) => Promise<unknown>
  put: (row: unknown) => Promise<unknown>
  delete: (id: string) => Promise<void>
}

function tableFor(name: SyncTable): AnyTable {
  switch (name) {
    case 'projects':
      return db.projects as unknown as AnyTable
    case 'focusTexts':
      return db.focusTexts as unknown as AnyTable
    case 'genres':
      return db.genres as unknown as AnyTable
    case 'worksheets':
      return db.worksheets as unknown as AnyTable
    case 'capturedNotes':
      return db.capturedNotes as unknown as AnyTable
    case 'entries':
      return db.entries as unknown as AnyTable
  }
}

export async function mergeShards(shards: Shard[]): Promise<void> {
  // 1. Pick a winner per key across all shards.
  const winners = new Map<string, { rec: ShardRecord; authorId: string }>()
  for (const shard of shards) {
    const authorId = shard.authorId ?? ''
    for (const [key, rec] of Object.entries(shard.records ?? {})) {
      const cur = winners.get(key)
      if (
        !cur ||
        rec.updated_at > cur.rec.updated_at ||
        (rec.updated_at === cur.rec.updated_at && authorId > cur.authorId)
      ) {
        winners.set(key, { rec, authorId })
      }
    }
  }

  // 2. Apply winners, never clobbering a locally dirty row.
  const dirty = await dirtyKeys()
  for (const [key, { rec }] of winners) {
    if (dirty.has(key)) continue
    const id = key.slice(rec.table.length + 1)
    const table = tableFor(rec.table)

    if (rec.table === 'capturedNotes') {
      if (rec.op === 'delete') continue // immutable: never delete provenance
      const local = (await table.get(id)) as CapturedNote | undefined
      const incoming = rec.data as CapturedNote | undefined
      if (!local) {
        if (incoming) await table.put(incoming)
        continue
      }
      // Presence-based archive/restore precedence. NOTE: this reads the row's
      // own updated_at, not the outbox envelope's (trackUpsert stamps the
      // envelope with created_at as a fallback, so the envelope always has one).
      if (!incoming?.updated_at) continue // plain replay: never overwrites anything
      if (local.updated_at && local.updated_at >= incoming.updated_at) continue
      await table.put({
        ...incoming,
        raw_text: local.raw_text,
        created_at: local.created_at,
      })
      continue
    }

    if (rec.op === 'delete') {
      const local = (await table.get(id)) as Timestamped | undefined
      if (local && ts(local) > rec.updated_at) continue // local newer; keep it
      await table.delete(id)
      continue
    }

    // Row-order sidecars UNION rather than replace.
    //
    // A repeatable table stores its row order as a JSON array on one entry, read
    // then written with no locking. Under plain last-write-wins, two people
    // adding a row within the same flush window means one array wins outright and
    // the other person's row id disappears from the order, while the cells they
    // typed into it survive as orphans nothing renders. Most answers on this
    // worksheet live in table cells, so this is exactly where work would appear
    // to vanish. A union keeps both rows and converges no matter who arrives
    // first. Known and accepted limitation: removing a row can resurrect it if
    // someone else was editing inside it.
    if (isRowOrder(rec)) {
      await mergeRowOrder(id, rec)
      continue
    }

    const local = (await table.get(id)) as Timestamped | undefined
    if (local && ts(local) >= rec.updated_at) continue // local same/newer; keep it
    if (rec.data) {
      await recordOverwrite(rec, local)
      await table.put(rec.data)
    }
  }
}

interface AnswerRow {
  id: string
  project_id?: string
  node_id?: string
  cell_key?: string
  text?: string
  value?: string
  updated_at?: string
  last_author?: string
}

/**
 * How recently this account must have written an answer for a teammate
 * replacing it to count as a collision worth interrupting someone over.
 *
 * The feature exists for two people in the same cell at the same moment. A
 * teammate revising something you wrote last week is ordinary collaborative
 * work, and announcing it turns the toast into background noise people learn to
 * dismiss. The history row is written either way, so nothing is lost by staying
 * quiet — it is only the interruption that is bounded.
 */
const COLLISION_WINDOW_MS = 10 * 60 * 1000

/**
 * Keep a copy of anything a teammate's edit replaces.
 *
 * Last-write-wins is the right conflict rule here (one Entry per cell, so real
 * collisions are two people in the same cell at the same moment) but its cost is
 * that the loser's text is simply gone, with nothing on screen to say so. The
 * history table and its viewer already exist for local edits; writing a row here
 * too turns every remote overwrite from a silent loss into something a
 * facilitator can find and paste back. Roughly twenty lines for the difference
 * between "the app lost my answer" and "here it is".
 *
 * Only for entries, only when the local text was non-empty and genuinely
 * different, so ordinary replication does not fill history with noise.
 */
async function recordOverwrite(rec: ShardRecord, local: Timestamped | undefined): Promise<void> {
  if (rec.table !== 'entries' || !local) return
  const before = local as AnswerRow
  const after = rec.data as AnswerRow
  const hadContent = Boolean(before.text?.trim() || before.value)
  const changed = before.text !== after.text || before.value !== after.value
  if (!hadContent || !changed) return

  await db.history.add({
    entry_id: before.id,
    project_id: before.project_id ?? '',
    node_id: before.node_id ?? '',
    cell_key: before.cell_key,
    prev_text: before.text,
    prev_value: before.value,
    changed_at: new Date().toISOString(),
    source: 'sync-overwrite',
  })

  // The history row makes it recoverable; this makes it noticed. Emitting after
  // the write, so a notice can never point at a row that does not exist yet.
  if (!(await isCollision(before, after))) return
  emitOverwrite({
    entryId: before.id,
    projectId: before.project_id ?? '',
    nodeId: before.node_id ?? '',
    cellKey: before.cell_key,
    prevText: before.text,
    prevValue: before.value,
    byAuthor: after.last_author,
  })
}

/**
 * Is this worth interrupting someone about?
 *
 * The history row above is written for EVERY overwrite and that does not
 * change. This decides only whether a person is told, and it is deliberately
 * narrow: text this account wrote, recently, replaced by somebody else.
 *
 * The bug it fixes: "your answer" used to mean nothing more than "the text that
 * happened to be in this browser's copy of the row". Everyone on a team holds a
 * copy of everyone's answers, so a person who had typed nothing all morning was
 * warned every time anyone else typed anything, every three seconds, about
 * work that was never theirs.
 */
async function isCollision(before: AnswerRow, after: AnswerRow): Promise<boolean> {
  const me = await myAuthorIds()
  // Mine: this ACCOUNT wrote the text being replaced. Matching a set rather
  // than one id is what keeps work typed before signing in counting as mine.
  if (!before.last_author || !me.has(before.last_author)) return false
  // Theirs: an absent author is an older client, which cannot be this device —
  // `mine` already proved this device's account wrote what was there.
  if (after.last_author && me.has(after.last_author)) return false

  // Recent, bounded at BOTH ends. A row's `updated_at` comes from whichever
  // device last wrote it, and `mine` is true for this person's other devices
  // too, so this can be a laptop's clock read against an iPad's `Date.now()`.
  // Workshop clocks run minutes fast (see the note on capturedNotes above), and
  // without the lower bound a fast peer clock would make a row permanently
  // "recent". A missing or unparseable stamp gives NaN, which fails both tests.
  const age = Date.now() - Date.parse(before.updated_at ?? '')
  return Number.isFinite(age) && age >= 0 && age < COLLISION_WINDOW_MS
}

const ROWS_KEY = '__rows'

interface RowOrderEntry {
  id: string
  cell_key?: string
  value?: string
  updated_at?: string
}

function isRowOrder(rec: ShardRecord): boolean {
  return (
    rec.table === 'entries' &&
    rec.op === 'upsert' &&
    (rec.data as RowOrderEntry | undefined)?.cell_key === ROWS_KEY
  )
}

function parseRows(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

async function mergeRowOrder(id: string, rec: ShardRecord): Promise<void> {
  // The shard always carries a whole Entry, so the merged row is a complete
  // record; the narrow RowOrderEntry above is only for reading the two fields
  // this cares about.
  const incoming = rec.data as Entry
  const local = await db.entries.get(id)

  const localRows = parseRows(local?.value)
  const remoteRows = parseRows(incoming.value)

  // Local order first so a person's own list does not reshuffle under them; then
  // anything only the other device knows about, appended.
  const merged = [...localRows]
  for (const rowId of remoteRows) if (!merged.includes(rowId)) merged.push(rowId)

  if (local && merged.length === localRows.length && merged.every((r, i) => r === localRows[i])) {
    return // nothing new; leave the local row and its timestamp alone
  }

  await db.entries.put({
    ...incoming,
    value: JSON.stringify(merged),
    // The union is neither side's write, and a row-order sidecar has no author
    // in any case. Pinning the local value keeps the field from quietly
    // becoming false, the same way `raw_text` is pinned for capturedNotes.
    last_author: local?.last_author,
    // The union is a new fact neither side had, so it must be newer than both or
    // the next pull would treat it as stale and overwrite it back.
    updated_at: newestOf(local?.updated_at, incoming.updated_at),
  })
}

function newestOf(a: string | undefined, b: string | undefined): string {
  const newest = (a ?? '') > (b ?? '') ? (a ?? '') : (b ?? '')
  return newest || new Date().toISOString()
}
