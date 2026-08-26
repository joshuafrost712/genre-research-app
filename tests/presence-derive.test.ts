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

/** A roster entry: presence carries a join stamp and nothing else. */
function joined(secondsAgo = 0, ref = 'r1') {
  return { at: new Date(NOW - secondsAgo * 1000).toISOString(), presence_ref: ref }
}

/** A `node` broadcast, as it arrives from a peer. */
function claim(userId: string, nodeId: string | null, secondsAgo = 0) {
  return { userId, nodeId, at: new Date(NOW - secondsAgo * 1000).toISOString() }
}

/** The room: who is on the roster, and what each has claimed. */
function room(
  people: Record<string, { joinedAgo?: number; nodeId?: string | null; claimedAgo?: number }>,
) {
  const presence: Record<string, unknown[]> = {}
  const nodes: Record<string, unknown> = {}
  for (const [userId, spec] of Object.entries(people)) {
    presence[userId] = [joined(spec.joinedAgo ?? 0)]
    if (spec.nodeId !== undefined) nodes[userId] = claim(userId, spec.nodeId, spec.claimedAgo ?? 0)
  }
  return { presence, nodes }
}

const derive = (input: unknown, selfId: string | null = ME) =>
  derivePresence(input as never, { selfId, now: NOW, ttlMs: PRESENCE_TTL_MS })

describe('derivePresence', () => {
  it('excludes you, keyed on the account id', () => {
    const snapshot = derive(
      room({ [ME]: { nodeId: 's1.setting' }, [PRIYA]: { nodeId: 's1.performers' } }),
    )
    expect(snapshot.people.map((p) => p.userId)).toEqual([PRIYA])
    expect(snapshot.byNode.get('s1.setting')).toBeUndefined()
    expect(snapshot.byNode.get('s1.performers')).toHaveLength(1)
  })

  it('counts two devices of one account as one person, not two', () => {
    // A laptop and a phone signed in as Priya. Realtime files both under her
    // presence key, which is exactly why the key is the unit of a person — and
    // both broadcast under the same account id, so there is one claim, not two.
    const snapshot = derive({
      presence: { [PRIYA]: [joined(30, 'laptop'), joined(2, 'phone')] },
      nodes: { [PRIYA]: claim(PRIYA, 's1.performers', 2) },
    })
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: 's1.performers' }])
    expect(snapshot.byNode.get('s1.setting')).toBeUndefined()
  })

  it('keeps a person with no nodeId in the count but on no tab', () => {
    const snapshot = derive(room({ [PRIYA]: { nodeId: null }, [SAM]: { nodeId: 's1.setting' } }))
    expect(snapshot.people).toHaveLength(2)
    expect(snapshot.byNode.size).toBe(1)
    expect(snapshot.byNode.get('s1.setting')?.map((p) => p.userId)).toEqual([SAM])
  })

  it('counts a newcomer who has not broadcast yet, on no tab', () => {
    // Broadcast keeps no history, so between joining and the first `node` message
    // a real person is on the roster and nowhere else. Counting only broadcasts
    // would leave them out of "N here now" — and leave them out permanently if
    // that first message is the one that gets lost.
    const snapshot = derive({ presence: { [PRIYA]: [joined(1)] }, nodes: {} })
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: null }])
    expect(snapshot.byNode.size).toBe(0)
  })

  it('releases a stale claim but keeps the person the roster still vouches for', () => {
    // A tab the OS froze with its socket open: Realtime has not removed them, so
    // they are still here, but their claim is old enough that the dot would be a
    // guess. Fail open — count them, show no dot.
    const snapshot = derive(
      room({ [PRIYA]: { nodeId: 's1.setting', claimedAgo: PRESENCE_TTL_MS / 1000 + 60 } }),
    )
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: null }])
    expect(snapshot.byNode.size).toBe(0)
  })

  it('drops a person once the roster and their claim are both stale', () => {
    const old = PRESENCE_TTL_MS / 1000 + 60
    const snapshot = derive(
      room({
        [PRIYA]: { joinedAgo: old, nodeId: 's1.setting', claimedAgo: old },
        [SAM]: { nodeId: 's1.setting', claimedAgo: 5 },
      }),
    )
    expect(snapshot.people.map((p) => p.userId)).toEqual([SAM])
    expect(snapshot.byNode.get('s1.setting')).toHaveLength(1)
  })

  it('ignores a claim from somebody who is not on the roster', () => {
    // Presence is authoritative for WHO: it is the half the server maintains, and
    // it drops a peer the moment their socket closes. A leftover broadcast from
    // somebody who has gone must not resurrect them as a dot nobody can explain.
    const snapshot = derive({
      presence: { [SAM]: [joined()] },
      nodes: { [SAM]: claim(SAM, 's1.setting'), [PRIYA]: claim(PRIYA, 's1.performers') },
    })
    expect(snapshot.people.map((p) => p.userId)).toEqual([SAM])
    expect(snapshot.byNode.get('s1.performers')).toBeUndefined()
  })

  it('believes a clock from the future now, and still expires it eventually', () => {
    // A tablet running an hour fast. It is shown, because dropping it would make a
    // working device invisible — but it does expire, once real time has passed its
    // stamp by a TTL. Asserting only the first line passes just as happily when
    // nothing clamps at all, which is what an earlier version of this test did
    // while its name promised otherwise.
    const future = {
      presence: { [PRIYA]: [{ at: new Date(NOW + 3_600_000).toISOString() }] },
      nodes: { [PRIYA]: claim(PRIYA, 's1.setting', -3600) },
    }
    const at = (now: number) =>
      derivePresence(future, { selfId: ME, now, ttlMs: PRESENCE_TTL_MS }).people
    expect(at(NOW)).toHaveLength(1)
    expect(at(NOW + 3_600_000 + PRESENCE_TTL_MS - 1000)).toHaveLength(1)
    expect(at(NOW + 3_600_000 + PRESENCE_TTL_MS + 1000)).toHaveLength(0)
  })

  it('yields an empty map for an empty or malformed payload rather than throwing', () => {
    // Both halves are remote input: another version of this app, or a teammate
    // with a console open. None of these may take the sidebar down.
    for (const raw of [
      undefined,
      null,
      {},
      'not an object',
      42,
      [],
      { presence: null },
      { presence: 'nope' },
      { presence: [] },
      { presence: { [PRIYA]: null } },
      { presence: { [PRIYA]: 'nope' } },
      { presence: { [PRIYA]: [] } },
      { presence: { [PRIYA]: [null] } },
      { presence: { [PRIYA]: [{}] } },
      { presence: { [PRIYA]: [{ at: 'yesterday' }] } },
      { presence: { [PRIYA]: [{ at: '' }] } },
      { presence: { '': [joined()] } },
      // A roster that is fine, with junk in the other half.
      { presence: { [PRIYA]: [joined()] }, nodes: 'nope' },
      { presence: { [PRIYA]: [joined()] }, nodes: [1, 2] },
    ]) {
      const snapshot = derivePresence(raw as never, { selfId: ME, now: NOW })
      // The last two have a real person on the roster; they must survive with no
      // dot rather than throw. The rest reduce to nobody.
      const expected = isRosteredButJunk(raw) ? [{ userId: PRIYA, nodeId: null }] : []
      expect(snapshot.people, JSON.stringify(raw)).toEqual(expected)
      expect(snapshot.byNode.size, JSON.stringify(raw)).toBe(0)
    }
  })

  it('treats a missing timestamp as stale, so nobody can pin themselves to a tab', () => {
    // Fail-closed is load-bearing: if an absent `at` counted as fresh, omitting the
    // field would be a permanent dot the TTL could never clear.
    const snapshot = derive({
      presence: { [PRIYA]: [{ presence_ref: 'r1' }] },
      nodes: { [PRIYA]: { userId: PRIYA, nodeId: 's1.setting' } },
    })
    expect(snapshot.people).toEqual([])
  })

  it('orders people stably, so two renders of one room agree', () => {
    const forward = derive(room({ [SAM]: { nodeId: 'a' }, [PRIYA]: { nodeId: 'a' } }))
    const backward = derive(room({ [PRIYA]: { nodeId: 'a' }, [SAM]: { nodeId: 'a' } }))
    expect(forward.people).toEqual(backward.people)
    expect(forward.people.map((p) => p.userId)).toEqual([PRIYA, SAM])
  })

  it('heartbeats often enough that sitting still does not expire you', () => {
    // The relationship, not the numbers: three heartbeats inside one TTL means two
    // can be lost to venue wifi without a dot flickering.
    expect(PRESENCE_HEARTBEAT_MS * 3).toBeLessThanOrEqual(PRESENCE_TTL_MS)
  })

  it('excludes nobody when there is no session, and still never throws', () => {
    const snapshot = derivePresence(room({ [PRIYA]: { nodeId: 's1.setting' } }), {
      selfId: null,
      now: NOW,
    })
    expect(snapshot.people.map((p) => p.userId)).toEqual([PRIYA])
  })
})

/** The two malformed cases above that still carry a real person on the roster. */
function isRosteredButJunk(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'nodes' in raw &&
    Array.isArray((raw as { presence?: Record<string, unknown> }).presence?.[PRIYA])
  )
}

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

  it('maps the group landing pages back to the group node the nav dots use', () => {
    // NavShell passes each group's own nodeId to PresenceDots alongside its
    // children. These two groups are linked as /describe/*, which matches neither
    // the dedicated-page map nor /worksheet/<id>, so before they were mapped the
    // group ids could never match anything and somebody sitting on a group
    // landing page was counted in the header while showing no dot anywhere.
    expect(nodeIdFromPath('/describe/big-picture')).toBe('s2')
    expect(nodeIdFromPath('/describe/style')).toBe('s3')
    // Leaf groups already worked, because the nav links them as worksheet routes.
    expect(nodeIdFromPath('/worksheet/s1b')).toBe('s1b')
  })

  it('answers null for a STAGE landing, which is not a node', () => {
    // A stage is a heading over several nodes, so somebody standing on one is in
    // the project and on no tab — the same answer as the genres page, and the
    // reason the header count can exceed the number of dots without either being
    // wrong.
    expect(nodeIdFromPath('/describe')).toBeNull()
    expect(nodeIdFromPath('/summary')).toBeNull()
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
