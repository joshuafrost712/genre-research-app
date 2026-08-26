/**
 * Turning what the channel knows into "who is here, and on which tab".
 *
 * Pure, and deliberately the only part of presence with tests. The channel
 * lifecycle needs two browsers to say anything true about it, but every rule that
 * decides what a person SEES lives here: one dot per person rather than per
 * device, never a dot for yourself, and a stale claim released rather than left
 * hanging on a tab nobody is on.
 *
 * TWO SOURCES, ON PURPOSE, and the split is the whole architecture.
 *
 * - **Presence** answers WHO. It is the roster, and Realtime drops an entry the
 *   instant its socket closes, which is the one thing no timer can do as well.
 * - **Broadcast** answers WHERE. One `node` message per navigation, plus a slow
 *   heartbeat.
 *
 * It was all presence once, and that shipped as far as a two-browser check and no
 * further: Realtime enforces a per-client PRESENCE rate limit that does not shed
 * the event, it CLOSES THE CHANNEL. Measured against this project, a client is
 * killed on its sixth `track()` at any interval up to five seconds; only ten-second
 * spacing survived. Since realtime-js does not rejoin a server-initiated close,
 * presence died silently about a minute into ordinary navigation — and "no dots"
 * is indistinguishable from an empty room, so nobody would have reported it.
 * Broadcast is a different limiter (100 events/second), verified at 40 sends in
 * 18s with the channel untouched.
 *
 * PRESENCE STATE IS REMOTE INPUT, and so is every broadcast. Both arrive from
 * another browser, which means another version of this app, or a tab asleep for an
 * hour, or (inside a team) somebody typing into a console. So nothing here trusts
 * a shape: a payload that is not what we expect reduces to "that person is not
 * there", because the failure that matters is a thrown exception blanking the
 * sidebar, not a missing dot.
 */

/**
 * How long a claim stays believable.
 *
 * Presence removes a peer when its socket closes, so this is not the main
 * mechanism — it is the second expiry the collaborative-data protocol asks for,
 * covering the case the transport cannot see: a phone whose tab was frozen by the
 * OS with the socket still nominally open. The direction of failure is the point.
 * A stale claim EXPIRES, so presence fails open (no dot, which is exactly the app
 * as it was before this shipped) rather than pinning a ghost to a tab.
 */
export const PRESENCE_TTL_MS = 180_000

/**
 * How often a client re-announces where it is. Must stay well under the TTL
 * above, or a person sitting still on one page ages out of their own tab. Three
 * heartbeats inside one TTL means two can be lost to a flaky venue wifi without a
 * dot flickering.
 *
 * SIXTY SECONDS IS A BUDGET DECISION, checked rather than guessed. Supabase's free
 * plan on 2026-08-25 allows 200 concurrent peak connections and 2 million Realtime
 * messages per month. Connections are a non-issue: a workshop is under ten people.
 * Messages are not, because every announcement fans out to every other member, so
 * the cost is quadratic in room size:
 *
 *   10 people × 60 announcements/hour × 10 recipients = 6,000 messages/hour
 *   ≈ 48k per eight-hour day, ≈ 480k over a ten-day workshop like Bali.
 *
 * That is a quarter of the monthly allowance. At the 25 seconds this first had, the
 * same workshop came to ~1.15M — over half the month's messages spent on heartbeats
 * for a decoration, and the arithmetic is what caught it.
 *
 * The heartbeat is now ONE broadcast rather than one presence track, so the
 * arithmetic above is unchanged. Presence itself costs a single `track()` per
 * join, which is why the rate limit that killed the first design cannot be reached
 * by navigating: navigation no longer touches presence at all.
 */
export const PRESENCE_HEARTBEAT_MS = 60_000

/**
 * What a client tracks about itself on the presence channel. Deliberately just a
 * timestamp, and even that is only for diagnostics: the moment `nodeId` lived in
 * here, every navigation became a presence event and the channel died.
 *
 * NOTHING HERE IS READ FOR LIVENESS. Presence membership is maintained by the
 * server — an entry exists if and only if a socket is open, and Phoenix's own
 * socket heartbeat retires a dead one — so being on the roster IS being present.
 * An earlier version applied the TTL to this stamp, which was written once at
 * join and never refreshed. The consequence was quiet and bad: after three
 * minutes every established member looked stale, so somebody joining a room that
 * had been working all morning counted NOBODY until the first re-announce
 * arrived, and counted nobody for a further minute if that message was lost.
 */
export interface PresencePayload {
  /** ISO timestamp of the join. Diagnostics only; see above. */
  at: string
}

/** What a client broadcasts on the `node` event when it moves. Keep it small. */
export interface NodePayload {
  /** Whose claim this is. Trusted only as a key — the topic is the boundary. */
  userId: string
  /** The worksheet node being viewed, or null anywhere else in the app. */
  nodeId: string | null
  /** ISO timestamp from the SENDER's clock. Diagnostics only; see NodeClaim. */
  at: string
}

/**
 * What we keep per account once a claim has arrived.
 *
 * `heardAt` IS OUR OWN CLOCK, not the sender's, and that is the whole point.
 * Ordering and expiry on a peer-supplied timestamp put a workshop's device
 * clocks — and anyone on the team with a console — in charge of both. One claim
 * stamped in the future used to pin an account's dot to the wrong node until real
 * time caught up: every later claim from them lost the last-write-wins comparison,
 * and the clamp meant the bad one never expired either. Local receipt time cannot
 * be poisoned, is monotonic for our purposes, and is a better answer to the only
 * question being asked — how long since we last heard from this person.
 */
export interface NodeClaim {
  /** The worksheet node they last reported, or null. */
  nodeId: string | null
  /** `Date.now()` when we received it. */
  heardAt: number
}

export interface PresencePerson {
  /**
   * The account id, which is also the presence key. One entry per ACCOUNT: a
   * laptop and a phone signed in as the same person are one person in the room.
   */
  userId: string
  /** Where they are, or null when they are somewhere with no tab of its own. */
  nodeId: string | null
}

export interface PresenceSnapshot {
  /** Everyone else present in the project. Never includes you. */
  people: PresencePerson[]
  /**
   * Who is on each worksheet node. Someone whose nodeId is null appears in
   * `people` and in no bucket here, which is how "3 here now" can sit above a
   * sidebar showing only two dots without either number being wrong.
   */
  byNode: Map<string, PresencePerson[]>
}

/** What `channel.ts` hands over: the roster, and the latest claim per account. */
export interface PresenceInput {
  /** Raw `channel.presenceState()`. */
  presence: unknown
  /** Latest `node` broadcast per account id. */
  nodes: unknown
}

const EMPTY: PresenceSnapshot = { people: [], byNode: new Map() }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Is this presence value a real roster entry?
 *
 * Presence state maps a key to an array of metas, one per device. The CONTENTS do
 * not matter — an older client that sends a different payload, or none, is still a
 * person with an open socket — so this asks only whether at least one device is
 * attached. Anything else (null, a string, an empty array) is not a roster entry
 * and reduces to nobody, because remote input must never throw here.
 */
function isRostered(entries: unknown): boolean {
  return Array.isArray(entries) && entries.length > 0
}

/** A stored claim, or null if it is not the shape we wrote. */
function asClaim(value: unknown): NodeClaim | null {
  if (!isRecord(value)) return null
  const heardAt = typeof value.heardAt === 'number' ? value.heardAt : NaN
  if (!Number.isFinite(heardAt)) return null
  return {
    nodeId: typeof value.nodeId === 'string' && value.nodeId ? value.nodeId : null,
    heardAt,
  }
}

export function derivePresence(
  input: PresenceInput | null | undefined,
  opts: { selfId: string | null; now?: number; ttlMs?: number },
): PresenceSnapshot {
  if (!isRecord(input) || !isRecord(input.presence)) return EMPTY
  const now = opts.now ?? Date.now()
  const ttlMs = opts.ttlMs ?? PRESENCE_TTL_MS
  const nodes = isRecord(input.nodes) ? input.nodes : {}

  const people: PresencePerson[] = []
  for (const [userId, entries] of Object.entries(input.presence)) {
    if (!userId || userId === opts.selfId) continue
    // The ROSTER decides who is here, on its own. See PresencePayload: presence
    // membership is server-maintained, so it needs no corroboration and gets no
    // TTL. A newcomer is counted the moment they appear, and everyone in a room
    // that has been open all morning keeps counting.
    if (!isRostered(entries)) continue

    // The DOT is the part with a TTL. A claim we have not heard renewed inside
    // one is released rather than left hanging on a page they may have left; that
    // covers the tab the OS froze with its socket still open, which is the case
    // the roster cannot see.
    const claim = asClaim(nodes[userId])
    const fresh = claim !== null && now - claim.heardAt <= ttlMs
    people.push({ userId, nodeId: fresh ? claim.nodeId : null })
  }

  // Sorted so two renders of the same room agree on the order of names, and so a
  // test can assert on the result rather than on a set.
  people.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))

  const byNode = new Map<string, PresencePerson[]>()
  for (const person of people) {
    if (!person.nodeId) continue
    const bucket = byNode.get(person.nodeId)
    if (bucket) bucket.push(person)
    else byNode.set(person.nodeId, [person])
  }

  return { people, byNode }
}
