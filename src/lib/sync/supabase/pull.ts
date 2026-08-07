/**
 * Pull new rows for a project and merge them into Dexie.
 *
 * Paging is on `server_at`, the server's own clock, NOT on `updated_at`. Device
 * clocks in a workshop room are wrong by minutes; if the cursor were a client
 * timestamp, one tablet running fast would write rows "in the future" and every
 * other device would page straight past them, permanently. `updated_at` still
 * decides who wins a conflict, which is why both columns exist.
 *
 * A first pull is this same function with no stored cursor, so adopting a project
 * you have never seen needs no separate snapshot path and paginates by construction.
 */
import { supabase } from '../../supabase/client'
import { db } from '../../storage/db'
import { mergeShards } from '../merge'
import type { Shard, ShardRecord, SyncTable } from '../types'
import { SYNC_TABLES } from '../types'

const PAGE = 500

/**
 * Rewind the cursor slightly on every save. Two rows committed in the same
 * instant can be assigned server_at values either side of the moment we read,
 * so an exact cursor can step over one. Merge is idempotent, so re-seeing a
 * handful of rows costs nothing and closes the gap.
 */
const OVERLAP_MS = 2_000

const cursorKey = (projectId: string) => `syncCursor:${projectId}`

export async function getCursor(projectId: string): Promise<string | undefined> {
  return (await db.meta.get(cursorKey(projectId)))?.value
}

export async function setCursor(projectId: string, serverAt: string): Promise<void> {
  const rewound = new Date(new Date(serverAt).getTime() - OVERLAP_MS).toISOString()
  await db.meta.put({ key: cursorKey(projectId), value: rewound })
}

/** Forget where we were, so the next pull re-reads the project from the start. */
export async function resetCursor(projectId: string): Promise<void> {
  await db.meta.delete(cursorKey(projectId))
}

interface Row {
  tbl: string
  record_id: string
  op: 'upsert' | 'delete'
  updated_at: string
  author_id: string
  data: unknown
  server_at: string
}

function isSyncTable(name: string): name is SyncTable {
  return (SYNC_TABLES as string[]).includes(name)
}

export interface PullResult {
  applied: number
  /** Distinct author ids seen this pull, minus our own. Feeds the status chip. */
  authors: Set<string>
}

export async function pullProject(projectId: string, ownAuthorId: string): Promise<PullResult> {
  if (!supabase) return { applied: 0, authors: new Set() }

  let cursor = await getCursor(projectId)
  let applied = 0
  const authors = new Set<string>()

  for (;;) {
    let q = supabase
      .from('sync_records')
      .select('tbl,record_id,op,updated_at,author_id,data,server_at')
      .eq('project_id', projectId)
      .order('server_at', { ascending: true })
      .limit(PAGE)
    if (cursor) q = q.gt('server_at', cursor)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as Row[]
    if (rows.length === 0) break

    // Group into per-author shards so merge.ts's existing tiebreak works unchanged.
    const shards = new Map<string, Shard>()
    for (const row of rows) {
      if (!isSyncTable(row.tbl)) continue // unknown table from a newer client
      if (row.author_id && row.author_id !== ownAuthorId) authors.add(row.author_id)

      const authorId = row.author_id || 'unknown'
      let shard = shards.get(authorId)
      if (!shard) {
        shard = { schemaVersion: '1', authorId, updatedAt: row.server_at, records: {} }
        shards.set(authorId, shard)
      }
      const rec: ShardRecord = {
        table: row.tbl,
        op: row.op,
        updated_at: row.updated_at,
        data: row.data ?? undefined,
      }
      shard.records[`${row.tbl}/${row.record_id}`] = rec
    }

    await mergeShards([...shards.values()])
    applied += rows.length

    const last = rows[rows.length - 1].server_at
    await setCursor(projectId, last)
    cursor = last

    if (rows.length < PAGE) break
  }

  return { applied, authors }
}
