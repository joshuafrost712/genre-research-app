/**
 * Flush: push this device's pending changes for a scope up to its shard file.
 * The shard is a cumulative snapshot of everything this author has contributed,
 * so we load the existing shard, fold in the pending ops (in order), and write it
 * back. Only ops belonging to the given scope's projects are drained; ops for
 * other scopes stay queued until that scope is active.
 */
import { allRows, removeRows } from './outbox'
import { getChangesFolderId, getProjectScopeKey, scopeKeyOf, type SyncScope } from './scope'
import { downloadJson, findFile, putJsonByName } from '../google/drive'
import { getAccount, getSyncAuthorId } from '../google/account'
import { db } from '../storage/db'
import { now } from '../util'
import { SHARD_SCHEMA_VERSION, type Shard } from './types'

export async function flush(scope: SyncScope): Promise<number> {
  const wantKey = scopeKeyOf(scope)
  const rows = await allRows()

  const mine: typeof rows = []
  for (const row of rows) {
    if ((await getProjectScopeKey(row.project_id)) === wantKey) mine.push(row)
  }
  if (mine.length === 0) return 0

  const changesFolderId = await getChangesFolderId(scope)
  const authorId = await getSyncAuthorId()
  const shardName = `${authorId}.json`

  const existingFile = await findFile(shardName, changesFolderId)
  const shard: Shard = (existingFile && (await downloadJson<Shard>(existingFile.id))) ?? {
    schemaVersion: SHARD_SCHEMA_VERSION,
    authorId,
    updatedAt: now(),
    records: {},
  }

  for (const op of mine) {
    shard.records[`${op.table}/${op.recordId}`] = {
      table: op.table,
      op: op.op,
      updated_at: op.updated_at,
      data: op.data,
    }
  }
  shard.authorId = authorId
  shard.authorEmail = (await getAccount())?.email
  shard.updatedAt = now()

  await putJsonByName(changesFolderId, shardName, shard)

  // Success: drain these rows and mark flushed entries synced (legacy field).
  await removeRows(mine.map((r) => r.seq).filter((s): s is number => typeof s === 'number'))
  for (const row of mine) {
    if (row.table === 'entries' && row.op === 'upsert') {
      try {
        await db.entries.update(row.recordId, { sync_status: 'synced' })
      } catch {
        /* entry may have been deleted since; ignore */
      }
    }
  }
  return mine.length
}
