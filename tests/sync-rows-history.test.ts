import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { mergeShards } from '../src/lib/sync/merge'
import type { Shard, ShardRecord } from '../src/lib/sync/types'
import type { Entry } from '../src/lib/types'

async function clearAll() {
  await Promise.all([db.entries.clear(), db.history.clear(), db.outbox.clear(), db.meta.clear()])
}

function entry(over: Partial<Entry> & { id: string; updated_at: string }): Entry {
  return {
    project_id: 'p1',
    node_id: 'n1',
    genre_id: 'g1',
    text: '',
    routing_status: 'none',
    sync_status: 'synced',
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Entry
}

function shard(authorId: string, records: Record<string, ShardRecord>): Shard {
  return { schemaVersion: '1', authorId, updatedAt: '2026-01-01T00:00:00.000Z', records }
}

function upsert(e: Entry): ShardRecord {
  return { table: 'entries', op: 'upsert', updated_at: e.updated_at!, data: e }
}

function rowOrder(id: string, rows: string[], updated_at: string): Entry {
  return entry({ id, cell_key: '__rows', value: JSON.stringify(rows), updated_at })
}

describe('mergeShards — repeatable-table row order', () => {
  beforeEach(clearAll)

  it('keeps both rows when two people add one at the same time', async () => {
    // The failure this prevents: under plain last-write-wins one array replaces
    // the other outright, the loser's rowId vanishes from the order, and the
    // cells they typed into it survive as orphans that nothing renders.
    await db.entries.put(rowOrder('rows1', ['r-base', 'r-mine'], '2026-06-01T10:00:00.000Z'))
    await mergeShards([
      shard('authorB', {
        'entries/rows1': upsert(rowOrder('rows1', ['r-base', 'r-theirs'], '2026-06-01T10:00:01.000Z')),
      }),
    ])

    expect(JSON.parse((await db.entries.get('rows1'))!.value!)).toEqual([
      'r-base',
      'r-mine',
      'r-theirs',
    ])
  })

  it('unions even when the incoming row is OLDER, because a union is not a conflict', async () => {
    await db.entries.put(rowOrder('rows1', ['r-mine'], '2026-06-01T12:00:00.000Z'))
    await mergeShards([
      shard('authorB', {
        'entries/rows1': upsert(rowOrder('rows1', ['r-theirs'], '2026-06-01T09:00:00.000Z')),
      }),
    ])
    expect(JSON.parse((await db.entries.get('rows1'))!.value!)).toEqual(['r-mine', 'r-theirs'])
  })

  it('stamps the union newer than both sides so the next pull cannot undo it', async () => {
    await db.entries.put(rowOrder('rows1', ['r-mine'], '2026-06-01T10:00:00.000Z'))
    const remote = '2026-06-01T11:00:00.000Z'
    await mergeShards([
      shard('authorB', { 'entries/rows1': upsert(rowOrder('rows1', ['r-theirs'], remote)) }),
    ])
    expect((await db.entries.get('rows1'))!.updated_at! >= remote).toBe(true)
  })

  it('preserves local order rather than reshuffling the list under someone', async () => {
    await db.entries.put(rowOrder('rows1', ['c', 'a', 'b'], '2026-06-01T10:00:00.000Z'))
    await mergeShards([
      shard('authorB', {
        'entries/rows1': upsert(rowOrder('rows1', ['a', 'b', 'c'], '2026-06-01T10:00:01.000Z')),
      }),
    ])
    expect(JSON.parse((await db.entries.get('rows1'))!.value!)).toEqual(['c', 'a', 'b'])
  })

  it('adopts the remote list wholesale when this device has never seen the table', async () => {
    await mergeShards([
      shard('authorB', {
        'entries/rows1': upsert(rowOrder('rows1', ['r1', 'r2'], '2026-06-01T10:00:00.000Z')),
      }),
    ])
    expect(JSON.parse((await db.entries.get('rows1'))!.value!)).toEqual(['r1', 'r2'])
  })
})

describe('mergeShards — history on remote overwrite', () => {
  beforeEach(clearAll)

  it('keeps the replaced answer so a lost edit is recoverable, not gone', async () => {
    await db.entries.put(entry({ id: 'e1', text: 'my careful answer', updated_at: '2026-06-01T10:00:00.000Z' }))
    await mergeShards([
      shard('authorB', {
        'entries/e1': upsert(entry({ id: 'e1', text: 'their answer', updated_at: '2026-06-01T11:00:00.000Z' })),
      }),
    ])

    expect((await db.entries.get('e1'))?.text).toBe('their answer')
    const rows = await db.history.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].prev_text).toBe('my careful answer')
    expect(rows[0].source).toBe('sync-overwrite')
  })

  it('writes nothing when the local cell was empty', async () => {
    await db.entries.put(entry({ id: 'e1', text: '', updated_at: '2026-06-01T10:00:00.000Z' }))
    await mergeShards([
      shard('authorB', {
        'entries/e1': upsert(entry({ id: 'e1', text: 'first answer', updated_at: '2026-06-01T11:00:00.000Z' })),
      }),
    ])
    expect(await db.history.count()).toBe(0)
  })

  it('writes nothing when the text is unchanged, so replication does not fill history', async () => {
    await db.entries.put(entry({ id: 'e1', text: 'same', updated_at: '2026-06-01T10:00:00.000Z' }))
    await mergeShards([
      shard('authorB', {
        'entries/e1': upsert(entry({ id: 'e1', text: 'same', updated_at: '2026-06-01T11:00:00.000Z' })),
      }),
    ])
    expect(await db.history.count()).toBe(0)
  })

  it('writes nothing for a first-time arrival with no local row to lose', async () => {
    await mergeShards([
      shard('authorB', {
        'entries/e1': upsert(entry({ id: 'e1', text: 'brand new', updated_at: '2026-06-01T11:00:00.000Z' })),
      }),
    ])
    expect(await db.history.count()).toBe(0)
  })
})
