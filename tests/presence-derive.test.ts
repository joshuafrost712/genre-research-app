/**
 * The rules that decide what presence SHOWS someone.
 *
 * The channel wiring needs two browsers to say anything true about it, and
 * scripts/verify-presence.mjs does that against the live project. What is left is
 * the reduction, and every case here is a way the sidebar could be quietly wrong:
 * your own second device standing on your tab as a stranger, a phone that was
 * asleep pinning a ghost to a page, or a peer's payload throwing and taking the
 * whole menu with it.
 */
import { describe, expect, it } from 'vitest'
import {
  derivePresence,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_MS,
} from '../src/lib/presence/derive'
import { nodeIdFromPath } from '../src/lib/presence/route'

const NOW = Date.parse('2026-08-25T12:00:00.000Z')
const ME = '11111111-1111-1111-1111-111111111111'
const PRIYA = '22222222-2222-2222-2222-222222222222'
const SAM = '33333333-3333-3333-3333-333333333333'

/** One presence entry, `secondsAgo` old. Realtime adds presence_ref; so do we. */
function entry(nodeId: string | null, secondsAgo = 0, ref = 'r1') {
  return { nodeId, at: new Date(NOW - secondsAgo * 1000).toISOString(), presence_ref: ref }
}

const derive = (raw: unknown, selfId: string | null = ME) =>
  derivePresence(raw, { selfId, now: NOW, ttlMs: PRESENCE_TTL_MS })

describe('derivePresence', () => {
  it('excludes you, keyed on the account id', () => {
    const snapshot = derive({
      [ME]: [entry('s1.setting')],
      [PRIYA]: [entry('s1.performers')],
    })
    expect(snapshot.people.map((p) => p.userId)).toEqual([PRIYA])
    expect(snapshot.byNode.get('s1.setting')).toBeUndefined()
    expect(snapshot.byNode.get('s1.performers')).toHaveLength(1)
  })

  it('counts two devices of one account as one person, not two', () => {
    // A laptop and a phone signed in as Priya. Realtime files both under her
    // presence key, which is exactly why the key is the unit of a person.
    const snapshot = derive({
      [PRIYA]: [entry('s1.setting', 30, 'laptop'), entry('s1.performers', 2, 'phone')],
    })
    expect(snapshot.people).toHaveLength(1)
    // The newest device wins, because that is where she actually is.
    expect(snapshot.people[0].nodeId).toBe('s1.performers')
    expect(snapshot.byNode.get('s1.setting')).toBeUndefined()
    expect(snapshot.byNode.get('s1.performers')).toHaveLength(1)
  })

  it('keeps a person with no nodeId in the count but on no tab', () => {
    const snapshot = derive({
      [PRIYA]: [entry(null)],
      [SAM]: [entry('s1.setting')],
    })
    expect(snapshot.people).toHaveLength(2)
    expect(snapshot.byNode.size).toBe(1)
    expect(snapshot.byNode.get('s1.setting')?.map((p) => p.userId)).toEqual([SAM])
  })

  it('drops stale entries, and the account with them once all are stale', () => {
    const snapshot = derive({
      [PRIYA]: [entry('s1.setting', PRESENCE_TTL_MS / 1000 + 60)],
      [SAM]: [entry('s1.setting', 5)],
    })
    expect(snapshot.people.map((p) => p.userId)).toEqual([SAM])
    expect(snapshot.byNode.get('s1.setting')).toHaveLength(1)
  })

  it('ignores a stale device but keeps the account its fresh device reports', () => {
    const snapshot = derive({
      [PRIYA]: [
        entry('s1.setting', PRESENCE_TTL_MS / 1000 + 60, 'asleep-phone'),
        entry('s1.performers', 3, 'laptop'),
      ],
    })
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: 's1.performers' }])
  })

  it('does not let a clock from the future buy a longer life', () => {
    // A tablet running an hour fast. Clamped to "now", so it expires on schedule
    // rather than outliving everybody by an hour.
    const future = { nodeId: 's1.setting', at: new Date(NOW + 3_600_000).toISOString() }
    expect(derive({ [PRIYA]: [future] }).people).toHaveLength(1)
  })

  it('yields an empty map for an empty or malformed payload rather than throwing', () => {
    // Presence state is remote input: another version of this app, or a teammate
    // with a console open. None of these may take the sidebar down.
    for (const raw of [
      undefined,
      null,
      {},
      'not an object',
      42,
      [],
      { [PRIYA]: null },
      { [PRIYA]: 'nope' },
      { [PRIYA]: [] },
      { [PRIYA]: [null] },
      { [PRIYA]: [{}] },
      { [PRIYA]: [{ nodeId: 5, at: 'yesterday' }] },
      { [PRIYA]: [{ nodeId: 's1.setting' }] }, // no `at` at all
      { [PRIYA]: [{ nodeId: 's1.setting', at: '' }] },
      { '': [entry('s1.setting')] },
    ]) {
      const snapshot = derivePresence(raw, { selfId: ME, now: NOW })
      expect(snapshot.people, JSON.stringify(raw)).toEqual([])
      expect(snapshot.byNode.size, JSON.stringify(raw)).toBe(0)
    }
  })

  it('treats a missing timestamp as stale, so nobody can pin themselves to a tab', () => {
    // Fail-closed is load-bearing: if an absent `at` counted as fresh, omitting the
    // field would be a permanent dot the TTL could never clear.
    const snapshot = derive({ [PRIYA]: [{ nodeId: 's1.setting' }] })
    expect(snapshot.people).toEqual([])
  })

  it('orders people stably, so two renders of one room agree', () => {
    const forward = derive({ [SAM]: [entry('a')], [PRIYA]: [entry('a')] })
    const backward = derive({ [PRIYA]: [entry('a')], [SAM]: [entry('a')] })
    expect(forward.people).toEqual(backward.people)
    expect(forward.people.map((p) => p.userId)).toEqual([PRIYA, SAM])
  })

  it('heartbeats often enough that sitting still does not expire you', () => {
    // The relationship, not the numbers: three heartbeats inside one TTL means two
    // can be lost to venue wifi without a dot flickering.
    expect(PRESENCE_HEARTBEAT_MS * 3).toBeLessThanOrEqual(PRESENCE_TTL_MS)
  })

  it('excludes nobody when there is no session, and still never throws', () => {
    const snapshot = derivePresence({ [PRIYA]: [entry('s1.setting')] }, { selfId: null, now: NOW })
    expect(snapshot.people.map((p) => p.userId)).toEqual([PRIYA])
  })
})

describe('nodeIdFromPath', () => {
  it('reads the worksheet node out of the path', () => {
    expect(nodeIdFromPath('/worksheet/s1.setting')).toBe('s1.setting')
    expect(nodeIdFromPath('/worksheet/s1.setting/')).toBe('s1.setting')
  })

  it('maps the three dedicated pages back to the subsection the nav links', () => {
    // The sidebar links these as /worksheet/<id> and WorksheetView redirects, so
    // without the reverse map a person sitting on a tab the nav itself offers would
    // show no dot on it.
    expect(nodeIdFromPath('/choose')).toBe('s0.genre_choice')
    expect(nodeIdFromPath('/macro')).toBe('s0.macro_notes')
    expect(nodeIdFromPath('/style')).toBe('s0.stylistic_notes')
  })

  it('answers null anywhere with no tab of its own', () => {
    for (const path of ['/', '/genres', '/export', '/teams', '/help', '/worksheet', '/worksheet/a/b']) {
      expect(nodeIdFromPath(path), path).toBeNull()
    }
  })

  it('answers null for nothing at all', () => {
    expect(nodeIdFromPath(null)).toBeNull()
    expect(nodeIdFromPath(undefined)).toBeNull()
    expect(nodeIdFromPath('')).toBeNull()
  })
})
