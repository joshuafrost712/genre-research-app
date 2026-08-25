import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { mergeShards } from '../src/lib/sync/merge'
import type { Shard, ShardRecord } from '../src/lib/sync/types'
import type { Genre } from '../src/lib/types'

async function clearAll() {
  await Promise.all([
    db.genres.clear(),
    db.capturedNotes.clear(),
    db.entries.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

function genre(id: string, name: string, updated_at: string): Genre {
  return {
    id,
    project_id: 'p1',
    name,
    is_sensitive: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at,
  }
}

function shard(authorId: string, records: Record<string, ShardRecord>): Shard {
  return { schemaVersion: '1', authorId, updatedAt: '2026-01-01T00:00:00.000Z', records }
}

function genreUpsert(g: Genre): ShardRecord {
  return { table: 'genres', op: 'upsert', updated_at: g.updated_at!, data: g }
}

describe('mergeShards — LWW register', () => {
  beforeEach(clearAll)

  it('merges distinct records from two authors without clobbering (the team case)', async () => {
    const a = shard('authorA', { 'genres/g1': genreUpsert(genre('g1', 'Lament', '2026-06-01T10:00:00.000Z')) })
    const b = shard('authorB', { 'genres/g2': genreUpsert(genre('g2', 'Praise', '2026-06-01T10:05:00.000Z')) })
    await mergeShards([a, b])

    const all = await db.genres.toArray()
    expect(all.map((g) => g.name).sort()).toEqual(['Lament', 'Praise'])
  })

  it('newer updated_at wins for the same record', async () => {
    const older = shard('authorA', { 'genres/g1': genreUpsert(genre('g1', 'Old name', '2026-06-01T10:00:00.000Z')) })
    const newer = shard('authorB', { 'genres/g1': genreUpsert(genre('g1', 'New name', '2026-06-01T11:00:00.000Z')) })
    await mergeShards([older, newer])
    expect((await db.genres.get('g1'))?.name).toBe('New name')
  })

  it('breaks ties deterministically by authorId', async () => {
    const sameTime = '2026-06-01T10:00:00.000Z'
    const a = shard('authorA', { 'genres/g1': genreUpsert(genre('g1', 'A wins?', sameTime)) })
    const z = shard('authorZ', { 'genres/g1': genreUpsert(genre('g1', 'Z wins', sameTime)) })
    await mergeShards([a, z])
    expect((await db.genres.get('g1'))?.name).toBe('Z wins') // 'authorZ' > 'authorA'
  })

  it('applies a delete tombstone, but keeps a locally-newer row', async () => {
    await db.genres.put(genre('g1', 'Local', '2026-06-01T10:00:00.000Z'))
    await mergeShards([
      shard('authorB', {
        'genres/g1': { table: 'genres', op: 'delete', updated_at: '2026-06-01T11:00:00.000Z' },
      }),
    ])
    expect(await db.genres.get('g1')).toBeUndefined()

    // A delete older than the local row must not win.
    await db.genres.put(genre('g2', 'Keep me', '2026-06-01T12:00:00.000Z'))
    await mergeShards([
      shard('authorB', {
        'genres/g2': { table: 'genres', op: 'delete', updated_at: '2026-06-01T09:00:00.000Z' },
      }),
    ])
    expect((await db.genres.get('g2'))?.name).toBe('Keep me')
  })

  it('treats captured notes as immutable provenance (insert-once, never delete)', async () => {
    await db.capturedNotes.put({ id: 'n1', project_id: 'p1', raw_text: 'original', created_at: 't' })
    // A remote upsert must not overwrite an existing note...
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n1': {
          table: 'capturedNotes',
          op: 'upsert',
          updated_at: '2026-06-01T11:00:00.000Z',
          data: { id: 'n1', project_id: 'p1', raw_text: 'tampered', created_at: 't' },
        },
      }),
    ])
    expect((await db.capturedNotes.get('n1'))?.raw_text).toBe('original')

    // ...and a remote delete must be ignored entirely.
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n1': { table: 'capturedNotes', op: 'delete', updated_at: '2026-06-01T12:00:00.000Z' },
      }),
    ])
    expect(await db.capturedNotes.get('n1')).toBeDefined()
  })

  it('captured-note archives are presence-based, immune to clock skew', async () => {
    // Device clocks in a workshop room are wrong by minutes (pull.ts), so the
    // rule is: a row-level `updated_at` (only archive/restore ever writes one)
    // beats absence in BOTH directions; `created_at` is never consulted.

    // 1. Replay case: an old-client replay whose created_at is NEWER than the
    // local archive's updated_at must NOT resurrect the note.
    await db.capturedNotes.put({
      id: 'n1',
      project_id: 'p1',
      raw_text: 'original',
      created_at: '2026-06-01T10:00:00.000Z',
      dismissed_at: '2026-06-01T10:05:00.000Z',
      updated_at: '2026-06-01T10:05:00.000Z',
    })
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n1': {
          table: 'capturedNotes',
          op: 'upsert',
          updated_at: '2026-06-01T10:30:00.000Z', // envelope stamp; row below has none
          data: {
            id: 'n1',
            project_id: 'p1',
            raw_text: 'original',
            created_at: '2026-06-01T10:30:00.000Z', // fast clock: newer than the archive
          },
        },
      }),
    ])
    expect((await db.capturedNotes.get('n1'))?.dismissed_at).toBe('2026-06-01T10:05:00.000Z')

    // 2. Mirror skew case: a local plain row whose created_at is NEWER than the
    // incoming archive's updated_at still gets archived.
    await db.capturedNotes.put({
      id: 'n2',
      project_id: 'p1',
      raw_text: 'kept text',
      created_at: '2026-06-01T11:00:00.000Z', // fast local clock
    })
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n2': {
          table: 'capturedNotes',
          op: 'upsert',
          updated_at: '2026-06-01T10:40:00.000Z',
          data: {
            id: 'n2',
            project_id: 'p1',
            raw_text: 'tampered en route',
            created_at: '2026-06-01T09:00:00.000Z',
            dismissed_at: '2026-06-01T10:40:00.000Z',
            updated_at: '2026-06-01T10:40:00.000Z',
          },
        },
      }),
    ])
    const n2 = await db.capturedNotes.get('n2')
    expect(n2?.dismissed_at).toBe('2026-06-01T10:40:00.000Z')
    // Immutable half stays pinned to the local copy even when the archive applies.
    expect(n2?.raw_text).toBe('kept text')
    expect(n2?.created_at).toBe('2026-06-01T11:00:00.000Z')
  })

  it('between two archive/restore rows, newer updated_at wins (restore then archive converges)', async () => {
    // Restored on this device...
    await db.capturedNotes.put({
      id: 'n1',
      project_id: 'p1',
      raw_text: 'original',
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T10:10:00.000Z', // restore kept the stamp, no dismissed_at
    })
    // ...then archived later on another device: the later archive wins.
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n1': {
          table: 'capturedNotes',
          op: 'upsert',
          updated_at: '2026-06-01T10:20:00.000Z',
          data: {
            id: 'n1',
            project_id: 'p1',
            raw_text: 'original',
            created_at: '2026-06-01T10:00:00.000Z',
            dismissed_at: '2026-06-01T10:20:00.000Z',
            updated_at: '2026-06-01T10:20:00.000Z',
          },
        },
      }),
    ])
    expect((await db.capturedNotes.get('n1'))?.dismissed_at).toBe('2026-06-01T10:20:00.000Z')

    // And the reverse: an OLDER archive must not clobber a newer restore.
    await db.capturedNotes.put({
      id: 'n2',
      project_id: 'p1',
      raw_text: 'original',
      created_at: '2026-06-01T10:00:00.000Z',
      updated_at: '2026-06-01T11:00:00.000Z', // newer restore
    })
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n2': {
          table: 'capturedNotes',
          op: 'upsert',
          updated_at: '2026-06-01T10:30:00.000Z',
          data: {
            id: 'n2',
            project_id: 'p1',
            raw_text: 'original',
            created_at: '2026-06-01T10:00:00.000Z',
            dismissed_at: '2026-06-01T10:30:00.000Z',
            updated_at: '2026-06-01T10:30:00.000Z',
          },
        },
      }),
    ])
    expect((await db.capturedNotes.get('n2'))?.dismissed_at).toBeUndefined()
  })

  it('a locally-dirty archive is not clobbered by a pull', async () => {
    await db.capturedNotes.put({
      id: 'n1',
      project_id: 'p1',
      raw_text: 'original',
      created_at: '2026-06-01T10:00:00.000Z',
      dismissed_at: '2026-06-01T10:05:00.000Z',
      updated_at: '2026-06-01T10:05:00.000Z',
    })
    await db.outbox.add({
      table: 'capturedNotes',
      recordId: 'n1',
      project_id: 'p1',
      op: 'upsert',
      updated_at: '2026-06-01T10:05:00.000Z',
    })
    await mergeShards([
      shard('authorB', {
        'capturedNotes/n1': {
          table: 'capturedNotes',
          op: 'upsert',
          updated_at: '2026-06-01T11:00:00.000Z',
          data: {
            id: 'n1',
            project_id: 'p1',
            raw_text: 'original',
            created_at: '2026-06-01T10:00:00.000Z',
            updated_at: '2026-06-01T11:00:00.000Z', // a newer remote restore
          },
        },
      }),
    ])
    // The dirty guard wins: the local archive flushes and global LWW settles it.
    expect((await db.capturedNotes.get('n1'))?.dismissed_at).toBe('2026-06-01T10:05:00.000Z')
  })

  it('never overwrites a locally-dirty row, even with a newer remote value', async () => {
    await db.genres.put(genre('g1', 'My unsynced edit', '2026-06-01T10:00:00.000Z'))
    // Simulate a pending local change in the outbox for g1.
    await db.outbox.add({
      table: 'genres',
      recordId: 'g1',
      project_id: 'p1',
      op: 'upsert',
      updated_at: '2026-06-01T10:00:00.000Z',
    })
    await mergeShards([
      shard('authorB', { 'genres/g1': genreUpsert(genre('g1', 'Remote newer', '2026-06-01T11:00:00.000Z')) }),
    ])
    // Local edit survives; it will flush and the global LWW resolves it next round.
    expect((await db.genres.get('g1'))?.name).toBe('My unsynced edit')
  })
})
