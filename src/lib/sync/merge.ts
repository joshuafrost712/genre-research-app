/**
 * Last-write-wins merge of downloaded shards into the local Dexie store.
 *
 * Rules (in order):
 *  - Across all shards, the newest `updated_at` per `table/recordId` wins; ties
 *    break by `authorId` for determinism.
 *  - A record currently dirty in the local outbox is never overwritten — the
 *    local edit will flush and the global LWW resolves it next round. This is
 *    what keeps a pull from eating local unsynced edits.
 *  - capturedNotes are immutable provenance: insert-once, ignore update/delete.
 *  - Otherwise a remote upsert applies only when strictly newer than the local
 *    row; a remote delete applies unless the local row is newer.
 */
import { db } from '../storage/db'
import { dirtyKeys } from './outbox'
import type { Shard, ShardRecord, SyncTable } from './types'

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
      const exists = await table.get(id)
      if (!exists && rec.data) await table.put(rec.data)
      continue
    }

    if (rec.op === 'delete') {
      const local = (await table.get(id)) as Timestamped | undefined
      if (local && ts(local) > rec.updated_at) continue // local newer; keep it
      await table.delete(id)
      continue
    }

    const local = (await table.get(id)) as Timestamped | undefined
    if (local && ts(local) >= rec.updated_at) continue // local same/newer; keep it
    if (rec.data) await table.put(rec.data)
  }
}
