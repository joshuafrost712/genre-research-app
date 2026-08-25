/**
 * The overwrite-visibility path: a teammate's edit replacing yours must leave
 * both a recoverable history row and a notice someone can act on.
 *
 * The failure this guards is the quiet one. Last-write-wins is correct here, so
 * these tests are not about preventing the overwrite — they are about it never
 * again happening in silence, and about Undo actually sticking rather than being
 * re-overwritten on the next pull.
 *
 * The second failure, found in a workshop, is the loud one. The notice used to
 * fire for any remote change to any non-empty answer already in this browser's
 * copy of the data, which on a team is nearly every answer. People who had
 * typed nothing were interrupted about everyone else's typing, every three
 * seconds. So most of what follows asserts SILENCE, and each silent case also
 * asserts that the history row was still written: quieting the toast must never
 * quiet the recovery path underneath it.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { mergeShards } from '../src/lib/sync/merge'
import { subscribeOverwrites, emitOverwrite, type OverwriteNotice } from '../src/lib/sync/notices'
import { restoreEntryText, upsertEntry, setBlockFollowUp, findEntry } from '../src/lib/storage/entries'
import { setDataOwner } from '../src/lib/storage/owner'
import { forgetIdentity } from '../src/lib/sync/identity'
import { testContext } from './helpers/context'
import type { Entry } from '../src/lib/types'
import type { Shard } from '../src/lib/sync/types'

/** This account, as `identity.ts` resolves it once `dataOwnerUid` is stamped. */
const ME = 'uid-me'
const THEM = 'uid-them'

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

/**
 * A local answer this account typed just now, which is the ONLY shape that can
 * produce a notice. Every "should fire" fixture has to be built from this: the
 * plain `entry()` above carries a fixed 2026-08-07 stamp and no author, so a
 * case built on it would pass by staying silent for the wrong reason.
 */
function mine(over: Partial<Entry> = {}): Entry {
  return entry({ last_author: ME, updated_at: new Date().toISOString(), ...over })
}

/** Their reply to it, stamped later so last-write-wins applies it. */
function theirs(text: string, over: Partial<Entry> = {}): Entry {
  return entry({ text, last_author: THEM, ...over })
}

const later = () => new Date(Date.now() + 1000).toISOString()

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
    // Without this the gate cannot recognise anyone, and every case would pass
    // by staying silent for a reason that has nothing to do with what it tests.
    forgetIdentity()
    await setDataOwner(ME, 'me@example.org')
  })

  it('delivers to subscribers and stops after unsubscribe', () => {
    const seen: OverwriteNotice[] = []
    const off = subscribeOverwrites((n) => seen.push(n))
    emitOverwrite({ entryId: 'a', projectId: 'p', nodeId: 'n' })
    off()
    emitOverwrite({ entryId: 'b', projectId: 'p', nodeId: 'n' })
    expect(seen.map((n) => n.entryId)).toEqual(['a'])
  })

  it('emits when a teammate replaces text this account typed a moment ago', async () => {
    await db.entries.put(mine({ text: 'mine' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('theirs'), later())])
    })

    expect(notices).toHaveLength(1)
    // The notice must carry the PREVIOUS text, since that is what Undo restores.
    expect(notices[0].prevText).toBe('mine')
    expect(notices[0].entryId).toBe('e1')
    // And who did it, so the toast can name them instead of saying "a teammate".
    expect(notices[0].byAuthor).toBe(THEM)
    // And the merge still applied — this is a notification, not a veto.
    expect((await db.entries.get('e1'))?.text).toBe('theirs')
    expect(await db.history.count()).toBe(1)
  })

  it('stays silent when the local text was never this account’s, and still records it', async () => {
    // The workshop bug, in one case. This browser holds a copy of an answer a
    // teammate wrote; another teammate edits it. Nothing of mine is at stake,
    // and I had been told otherwise every three seconds all morning.
    await db.entries.put(mine({ text: 'someone else’s answer', last_author: THEM }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('their revision', { last_author: 'uid-third' }), later())])
    })

    expect(notices).toHaveLength(0)
    // Silence is about the interruption only. The recovery path is untouched.
    expect(await db.history.count()).toBe(1)
  })

  it('stays silent when this account’s text is older than the collision window', async () => {
    // A teammate revising something I wrote last week is ordinary work, not a
    // collision. It is still recoverable from history.
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await db.entries.put(mine({ text: 'mine', updated_at: lastWeek }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('their revision'), later())])
    })

    expect(notices).toHaveLength(0)
    expect(await db.history.count()).toBe(1)
  })

  it('stays silent when the replacement came from this account on another device', async () => {
    // Authorship is keyed to the ACCOUNT, so a laptop and a phone are one
    // person. "A teammate replaced your answer" about your own other device is
    // the most confusing possible version of this message.
    await db.entries.put(mine({ text: 'typed on the laptop' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('typed on the phone', { last_author: ME }), later())])
    })

    expect(notices).toHaveLength(0)
    expect(await db.history.count()).toBe(1)
  })

  it('stays silent when a peer’s clock puts the local row in the future', async () => {
    // Workshop laptops run minutes fast, and the row's stamp came from whichever
    // device wrote it. Without a lower bound on age, a future stamp reads as
    // "written moments ago" forever.
    const ahead = new Date(Date.now() + 20 * 60 * 1000).toISOString()
    await db.entries.put(mine({ text: 'mine', updated_at: ahead }))

    const notices = await captureNotices(async () => {
      await mergeShards([
        shard(theirs('theirs'), new Date(Date.now() + 25 * 60 * 1000).toISOString()),
      ])
    })

    expect(notices).toHaveLength(0)
  })

  it('treats an unauthored remote row as somebody else', async () => {
    // An older client writes no author. It cannot be this device, because the
    // local row already proves this device's account wrote what was there.
    await db.entries.put(mine({ text: 'mine' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(entry({ text: 'from an old client' }), later())])
    })

    expect(notices).toHaveLength(1)
    expect(notices[0].byAuthor).toBeUndefined()
  })

  it('announces a teammate’s typing burst once, not once per pull', async () => {
    // The pull loop runs every three seconds while somebody types a sentence.
    // The first edit takes the row, so the rest are no longer replacing mine.
    await db.entries.put(mine({ text: 'mine' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('their'), later())])
      await mergeShards([shard(theirs('their ans'), new Date(Date.now() + 2000).toISOString())])
      await mergeShards([shard(theirs('their answer'), new Date(Date.now() + 3000).toISOString())])
    })

    expect(notices).toHaveLength(1)
    // All three still landed, and all three are recoverable.
    expect((await db.entries.get('e1'))?.text).toBe('their answer')
    expect(await db.history.count()).toBe(3)
  })

  it('stays silent for ordinary replication into an empty local answer', async () => {
    // Replicating a teammate's answer into a cell nobody here had filled is the
    // system working, not a collision. Announcing it would train people to
    // ignore the toast that matters.
    await db.entries.put(mine({ text: '' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('theirs'), later())])
    })

    expect(notices).toHaveLength(0)
    expect(await db.history.count()).toBe(0)
  })

  it('stays silent when the remote row carries identical text', async () => {
    await db.entries.put(mine({ text: 'same' }))

    const notices = await captureNotices(async () => {
      await mergeShards([shard(theirs('same'), later())])
    })

    expect(notices).toHaveLength(0)
  })
})

/**
 * Who a write makes the author, which is the other half of the same fix.
 *
 * Every flag toggle in the app goes through `upsertEntry`'s update branch, the
 * same one a real edit uses. Stamping authorship there unconditionally would
 * hand a teammate's answer to whoever last ticked a checkbox on it, and then
 * warn that person when its real author touched it — the workshop bug again,
 * through a side door, with the tests above still green.
 */
describe('answer authorship', () => {
  beforeEach(async () => {
    await db.entries.clear()
    await db.outbox.clear()
    forgetIdentity()
    await setDataOwner(ME, 'me@example.org')
  })

  it('does not move authorship when only a flag changes', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, 'n1', 'genre', { text: 'their answer' })
    const written = await findEntry(ctx, 'n1', 'genre')
    await db.entries.update(written!.id, { last_author: THEM }) // as if it arrived by sync

    await setBlockFollowUp(ctx, 'n1', 'genre', true)

    const after = await findEntry(ctx, 'n1', 'genre')
    expect(after?.is_concern_flag).toBe(true)
    expect(after?.last_author).toBe(THEM)
  })

  it('moves authorship when the text is rewritten', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, 'n2', 'genre', { text: 'their answer' })
    const written = await findEntry(ctx, 'n2', 'genre')
    await db.entries.update(written!.id, { last_author: THEM })

    await upsertEntry(ctx, 'n2', 'genre', { text: 'my rewrite' })

    expect((await findEntry(ctx, 'n2', 'genre'))?.last_author).toBe(ME)
  })

  it('stamps the account, not the device, so two devices are one author', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, 'n3', 'genre', { text: 'typed here' })
    expect((await findEntry(ctx, 'n3', 'genre'))?.last_author).toBe(ME)
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
