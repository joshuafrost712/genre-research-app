/**
 * The overwrite-visibility path: a teammate's edit replacing yours must leave
 * both a recoverable history row and a notice someone can act on.
 *
 * The failure this guards is the quiet one. Last-write-wins is correct here, so
 * these tests are not about preventing the overwrite — they are about it never
 * again happening in silence, and about Undo actually sticking rather than being
 * re-overwritten on the next pull.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { mergeShards } from '../src/lib/sync/merge'
import { subscribeOverwrites, emitOverwrite, type OverwriteNotice } from '../src/lib/sync/notices'
import { restoreEntryText } from '../src/lib/storage/entries'
import type { Entry } from '../src/lib/types'
import type { Shard } from '../src/lib/sync/types'

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    project_id: 'p1',
    node_id: 'n1',
    text: 'mine',
    routing_status: 'confirmed',
    schema_version: '1',
    sync_status: 'synced',
    created_at: '2026-08-07T10:00:00.000Z',
    updated_at: '2026-08-07T10:00:00.000Z',
    ...over,
  }
}

function shard(rec: Entry, updated_at: string, authorId = 'other'): Shard {
  return {
    schemaVersion: '1',
    authorId,
    updatedAt: updated_at,
    records: {
      [`entries/${rec.id}`]: { table: 'entries', op: 'upsert', updated_at, data: rec },
    },
  }
}

async function captureNotices(fn: () => Promise<void>): Promise<OverwriteNotice[]> {
  const seen: OverwriteNotice[] = []
  const off = subscribeOverwrites((n) => seen.push(n))
  try {
    await fn()
  } finally {
    off()
  }
  return seen
}

describe('overwrite notices', () => {
  beforeEach(async () => {
    await db.entries.clear()
    await db.history.clear()
    await db.outbox.clear()
  })

  it('delivers to subscribers and stops after unsubscribe', () => {
    const seen: OverwriteNotice[] = []
    const off = subscribeOverwrites((n) => seen.push(n))
    emitOverwrite({ entryId: 'a', projectId: 'p', nodeId: 'n' })
    off()
    emitOverwrite({ entryId: 'b', projectId: 'p', nodeId: 'n' })
    expect(seen.map((n) => n.entryId)).toEqual(['a'])
  })

  it('emits when a remote edit replaces different, non-empty local text', async () => {
    await db.entries.put(entry({ text: 'mine' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(entry({ text: 'theirs' }), '2026-08-07T11:00:00.000Z')])
    })

    expect(notices).toHaveLength(1)
    // The notice must carry the PREVIOUS text, since that is what Undo restores.
    expect(notices[0].prevText).toBe('mine')
    expect(notices[0].entryId).toBe('e1')
    // And the merge still applied — this is a notification, not a veto.
    expect((await db.entries.get('e1'))?.text).toBe('theirs')
    expect(await db.history.count()).toBe(1)
  })

  it('stays silent for ordinary replication into an empty local answer', async () => {
    // Replicating a teammate's answer into a cell nobody here had filled is the
    // system working, not a collision. Announcing it would train people to
    // ignore the toast that matters.
    await db.entries.put(entry({ text: '' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(entry({ text: 'theirs' }), '2026-08-07T11:00:00.000Z')])
    })

    expect(notices).toHaveLength(0)
    expect(await db.history.count()).toBe(0)
  })

  it('stays silent when the remote row carries identical text', async () => {
    await db.entries.put(entry({ text: 'same' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(entry({ text: 'same' }), '2026-08-07T11:00:00.000Z')])
    })

    expect(notices).toHaveLength(0)
  })
})

describe('restoreEntryText', () => {
  beforeEach(async () => {
    await db.entries.clear()
    await db.history.clear()
    await db.outbox.clear()
  })

  it('puts the text back and stamps it newer, so the next pull does not undo the undo', async () => {
    const replacedAt = '2026-08-07T11:00:00.000Z'
    await db.entries.put(entry({ text: 'theirs', updated_at: replacedAt }))

    const ok = await restoreEntryText('e1', 'mine', undefined)
    expect(ok).toBe(true)

    const row = await db.entries.get('e1')
    expect(row?.text).toBe('mine')
    // Strictly newer than the remote write it is undoing. merge.ts keeps a local
    // row only when `local >= remote`, so an equal or older stamp would let the
    // teammate's version win again on the very next cycle.
    expect(row!.updated_at > replacedAt).toBe(true)
    expect(row?.sync_status).toBe('local')
  })

  it('queues the restore for upload, or it would only ever be local', async () => {
    await db.entries.put(entry({ text: 'theirs' }))
    await restoreEntryText('e1', 'mine', undefined)

    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0].recordId).toBe('e1')
    expect(queued[0].op).toBe('upsert')
  })

  it('preserves the container fields, since the row is addressed by id alone', async () => {
    await db.entries.put(entry({ text: 'theirs', genre_id: 'g9', cell_key: 'r1__c2' }))
    await restoreEntryText('e1', 'mine', undefined)

    const row = await db.entries.get('e1')
    expect(row?.genre_id).toBe('g9')
    expect(row?.cell_key).toBe('r1__c2')
  })

  it('drops a translation cached against the text it is replacing', async () => {
    await db.entries.put(entry({ text: 'theirs', translations: { id: 'punya mereka' } }))
    await restoreEntryText('e1', 'mine', undefined)
    expect((await db.entries.get('e1'))?.translations).toBeUndefined()
  })

  it('reports false for an entry that is no longer there', async () => {
    expect(await restoreEntryText('gone', 'mine', undefined)).toBe(false)
  })
})
