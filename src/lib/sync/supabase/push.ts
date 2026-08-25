/**
 * Drain the local outbox into Postgres via the `push_records` RPC.
 *
 * The outbox APPENDS a row per write (outbox.ts), so a 400ms typing debounce
 * inside one flush window leaves several rows for the same cell. We collapse to
 * the newest per `table/recordId` before sending: it shrinks a typing burst by
 * roughly 7x, and `ON CONFLICT` would otherwise raise "cannot affect row a
 * second time" when one statement hits the same conflict target twice. The RPC
 * dedupes again server-side; this is the cheap half of that belt and braces.
 */
import { supabase } from '../../supabase/client'
import { allRows, removeRows } from '../outbox'
import { getAuthorId } from '../author'
import type { OutboxRow } from '../types'

/** Rows destined for one project, plus every outbox seq they supersede. */
interface Batch {
  projectId: string
  records: unknown[]
  seqs: number[]
}

const CHUNK = 200

/**
 * Collapse an outbox slice to one record per key, newest wins, remembering every
 * seq that fed into it so a successful push clears the superseded rows too.
 * Exported for tests: this is pure.
 */
export function collapse(rows: OutboxRow[], authorId: string): Batch[] {
  const byProject = new Map<string, Map<string, { row: OutboxRow; seqs: number[] }>>()

  for (const row of rows) {
    if (row.seq === undefined) continue
    let keyed = byProject.get(row.project_id)
    if (!keyed) {
      keyed = new Map()
      byProject.set(row.project_id, keyed)
    }
    const key = `${row.table}/${row.recordId}`
    const cur = keyed.get(key)
    if (!cur) {
      keyed.set(key, { row, seqs: [row.seq] })
    } else {
      cur.seqs.push(row.seq)
      // Outbox order is insertion order, so a later row is a later edit even when
      // two share a timestamp at the same millisecond.
      if (row.updated_at >= cur.row.updated_at) cur.row = row
    }
  }

  return [...byProject.entries()].map(([projectId, keyed]) => ({
    projectId,
    records: [...keyed.values()].map(({ row }) => ({
      tbl: row.table,
      record_id: row.recordId,
      op: row.op,
      updated_at: row.updated_at,
      author_id: authorId,
      data: row.op === 'delete' ? null : row.data,
    })),
    seqs: [...keyed.values()].flatMap(({ seqs }) => seqs),
  }))
}

export interface PushResult {
  pushed: number
  /** Projects the server refused us (42501). The caller stops syncing these. */
  forbidden: string[]
}

/**
 * Push everything pending for `syncedProjectIds`.
 *
 * Outbox rows for any OTHER project are dropped, not retried. Without that a
 * user working in a local-only project would accumulate rows forever, each round
 * pushing them at a filter that silently discards them: the outbox would grow
 * without bound while the status chip claimed a clean sync.
 */
export async function pushOutbox(syncedProjectIds: Set<string>): Promise<PushResult> {
  if (!supabase) return { pushed: 0, forbidden: [] }

  const rows = await allRows()
  if (rows.length === 0) return { pushed: 0, forbidden: [] }

  const authorId = await getAuthorId()
  const batches = collapse(rows, authorId)

  const unsynced = batches.filter((b) => !syncedProjectIds.has(b.projectId))
  if (unsynced.length) await removeRows(unsynced.flatMap((b) => b.seqs))

  let pushed = 0
  const forbidden: string[] = []

  for (const batch of batches) {
    if (!syncedProjectIds.has(batch.projectId)) continue

    // Per batch, never global: one project failing must not clear another's rows.
    let allSlicesLanded = true

    for (let i = 0; i < batch.records.length; i += CHUNK) {
      const slice = batch.records.slice(i, i + CHUNK)
      const { data: applied, error } = await supabase.rpc('push_records', {
        p_project: batch.projectId,
        p_records: slice,
      })

      if (error) {
        allSlicesLanded = false
        // 42501 is our own membership raise. Retrying cannot help, and leaving the
        // rows queued would wedge the outbox behind a project we cannot write to.
        if (error.code === '42501' || /not a member/i.test(error.message ?? '')) {
          forbidden.push(batch.projectId)
          await removeRows(batch.seqs)
        }
        // Any other error (offline, 5xx) leaves the rows queued for the next tick.
        break
      }
      // The RPC returns how many rows its LWW guard actually applied. A
      // shortfall is legitimate (someone else pushed a newer version first),
      // but it must be visible: a silently-losing write is how the skewed-clock
      // archive bug stayed invisible.
      if (typeof applied === 'number' && applied < slice.length) {
        console.warn(
          `push_records applied ${applied}/${slice.length} rows for project ${batch.projectId} (rest lost LWW)`,
        )
      }
      pushed += slice.length
    }

    if (allSlicesLanded) await removeRows(batch.seqs)
  }

  return { pushed, forbidden }
}
