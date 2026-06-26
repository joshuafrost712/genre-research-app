/**
 * Pull: download every shard in a scope's changes folder (skipping our own, which
 * is already reflected locally) and merge them into Dexie. Dexie live queries
 * refresh the UI automatically when the merge writes.
 *
 * When pulling a team scope, every project the shards touch is tagged locally as
 * belonging to that team, so a joined member's subsequent edits flush back to the
 * team folder rather than to their personal space.
 */
import { downloadJson, listChildren } from '../google/drive'
import { getChangesFolderId, scopeKeyOf, setProjectScopeKey, type SyncScope } from './scope'
import { getSyncAuthorId } from '../google/account'
import { mergeShards } from './merge'
import type { Shard } from './types'

export async function pull(scope: SyncScope): Promise<number> {
  const changesFolderId = await getChangesFolderId(scope)
  const files = await listChildren(changesFolderId)
  const ownShard = `${await getSyncAuthorId()}.json`

  const shards: Shard[] = []
  for (const file of files) {
    if (!file.name.endsWith('.json') || file.name === ownShard) continue
    const shard = await downloadJson<Shard>(file.id)
    if (shard?.records) shards.push(shard)
  }
  if (shards.length === 0) return 0

  await mergeShards(shards)

  if (scope.kind === 'team') {
    const projectIds = new Set<string>()
    for (const shard of shards) {
      for (const [key, rec] of Object.entries(shard.records)) {
        if (rec.table === 'projects') projectIds.add(key.slice('projects/'.length))
        else {
          const pid = (rec.data as { project_id?: string } | undefined)?.project_id
          if (pid) projectIds.add(pid)
        }
      }
    }
    const key = scopeKeyOf(scope)
    for (const pid of projectIds) await setProjectScopeKey(pid, key)
  }

  return shards.length
}
