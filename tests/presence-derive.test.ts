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

/** A roster entry: presence carries a join stamp, read by nothing. */
function joined(secondsAgo = 0, ref = 'r1') {
  return { at: new Date(NOW - secondsAgo * 1000).toISOString(), presence_ref: ref }
}

/**
 * A stored claim. `heardAt` is OUR clock at receipt, never the sender's — see
 * NodeClaim for the poisoning that peer timestamps allowed.
 */
function claim(nodeId: string | null, secondsAgo = 0) {
  return { nodeId, heardAt: NOW - secondsAgo * 1000 }
}

/** The room: who is on the roster, and what each has claimed. */
function room(
  people: Record<string, { joinedAgo?: number; nodeId?: string | null; claimedAgo?: number }>,
) {
  const presence: Record<string, unknown[]> = {}
  const nodes: Record<string, unknown> = {}
  for (const [userId, spec] of Object.entries(people)) {
    presence[userId] = [joined(spec.joinedAgo ?? 0)]
    if (spec.nodeId !== undefined) nodes[userId] = claim(spec.nodeId, spec.claimedAgo ?? 0)
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
      nodes: { [PRIYA]: claim('s1.performers', 2) },
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
    // a real person is on the roster and nowhere else.
    const snapshot = derive({ presence: { [PRIYA]: [joined(1)] }, nodes: {} })
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: null }])
    expect(snapshot.byNode.size).toBe(0)
  })

  it('counts an established member whose join stamp is ancient', () => {
    // THE ROSTER HAS NO TTL, and this is the case that forced it. Presence stamps
    // `at` once at join and never refreshes it, so applying the TTL to it made
    // everyone in a room that had been open all morning look stale — and somebody
    // arriving into that room counted NOBODY until the first re-announce landed.
    // Presence membership is server-maintained; being on it is being here.
    const snapshot = derive(
      room({ [PRIYA]: { joinedAgo: 8 * 60 * 60, nodeId: 's1.setting', claimedAgo: 5 } }),
    )
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: 's1.setting' }])
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

  it('ignores a claim from somebody who is not on the roster', () => {
    // Presence is authoritative for WHO: it is the half the server maintains, and
    // it drops a peer the moment their socket closes. A claim left behind by
    // somebody who has gone must not resurrect them as a dot nobody can explain —
    // which is also why the channel keeps no `leave` handler to prune them.
    const snapshot = derive({
      presence: { [SAM]: [joined()] },
      nodes: { [SAM]: claim('s1.setting'), [PRIYA]: claim('s1.performers') },
    })
    expect(snapshot.people.map((p) => p.userId)).toEqual([SAM])
    expect(snapshot.byNode.get('s1.performers')).toBeUndefined()
  })

  it('cannot be pinned to a tab by a claim stamped in the future', () => {
    // The channel stamps `heardAt` locally, so a peer's clock never reaches this
    // function. Belt to that brace: even if a future `heardAt` were stored, it must
    // not survive as a permanent dot. It is in the future, so it is not older than
    // the TTL and it shows — but one TTL past that stamp it is gone, and it can
    // never beat anything, because nothing here compares claims to each other.
    const snapshot = derivePresence(
      { presence: { [PRIYA]: [joined()] }, nodes: { [PRIYA]: claim('s1.setting', -3600) } },
      { selfId: ME, now: NOW + 3_600_000 + PRESENCE_TTL_MS + 1000, ttlMs: PRESENCE_TTL_MS },
    )
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: null }])
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
      { presence: { '': [joined()] } },
    ]) {
      const snapshot = derivePresence(raw as never, { selfId: ME, now: NOW })
      expect(snapshot.people, JSON.stringify(raw)).toEqual([])
      expect(snapshot.byNode.size, JSON.stringify(raw)).toBe(0)
    }
  })

  it('keeps a rostered person when their CLAIM is junk, on no tab', () => {
    // A device attached is a person present, whatever they are or are not saying
    // about where they are. The two halves fail independently on purpose.
    for (const nodes of [
      'nope',
      [1, 2],
      { [PRIYA]: null },
      { [PRIYA]: 'nope' },
      { [PRIYA]: {} },
      { [PRIYA]: { nodeId: 's1.setting' } }, // no heardAt
      { [PRIYA]: { nodeId: 5, heardAt: 'yesterday' } },
    ]) {
      const snapshot = derivePresence({ presence: { [PRIYA]: [joined()] }, nodes } as never, {
        selfId: ME,
        now: NOW,
      })
      expect(snapshot.people, JSON.stringify(nodes)).toEqual([{ userId: PRIYA, nodeId: null }])
      expect(snapshot.byNode.size, JSON.stringify(nodes)).toBe(0)
    }
  })

  it('treats a device with an unreadable presence meta as present anyway', () => {
    // Deliberate, and a change from the first design. The meta's CONTENTS are read
    // by nothing now, so an older client that sends a different payload — or none
    // — is still somebody with an open socket.
    const snapshot = derive({ presence: { [PRIYA]: [{}] }, nodes: {} })
    expect(snapshot.people).toEqual([{ userId: PRIYA, nodeId: null }])
  })

  it('orders people stably, so two renders of one room agree', () => {
    const forward = derive(room({ [SAM]: { nodeId: 'a' }, [PRIYA]: { nodeId: 'a' } }))
    const backward = derive(room({ [PRIYA]: { nodeId: 'a' }, [SAM]: { nodeId: 'a' } }))
    expect(forward.people).toEqual(backward.people)
    expect(forward.people.map((p) => p.userId)).toEqual([PRIYA, SAM])
  })

  it('heartbeats often enough that sitting still does not expire your dot', () => {
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
