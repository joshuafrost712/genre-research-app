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
 * timestamp: the roster needs to know somebody is here, and the moment `nodeId`
 * lived in here, every navigation became a presence event and the channel died.
 */
export interface PresencePayload {
  /** ISO timestamp of the join, so a newcomer counts before their first broadcast. */
  at: string
}

/** What a client broadcasts on the `node` event when it moves. Keep it small. */
export interface NodePayload {
  /** Whose claim this is. Trusted only as a key — the topic is the boundary. */
  userId: string
  /** The worksheet node being viewed, or null anywhere else in the app. */
  nodeId: string | null
  /** ISO timestamp of this announcement, for the TTL above. */
  at: string
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
 * A timestamp we are willing to believe, or null.
 *
 * Workshop device clocks are wrong by minutes in both directions, so a stamp from
 * the future is a device with a bad clock, not a lie to discard: drop it and a
 * correctly-working phone goes invisible, which is a worse failure than the one it
 * prevents. It is clamped to now instead.
 *
 * Note what clamping does NOT buy: such an entry still outlives a correct one,
 * because each read re-clamps and the age stays 0 until real time passes the
 * stamp. Clamping cannot fix that. The exposure is bounded and small, because
 * Realtime removes a presence entry the moment its socket closes, so the TTL only
 * ever covers a tab the OS froze with the socket still open.
 */
function believableAt(value: unknown, now: number): number | null {
  const raw = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(raw)) return null
  return Math.min(raw, now)
}

/**
 * The freshest believable timestamp across one account's presence metas, or null.
 *
 * An entry with no parseable `at` is skipped rather than treated as fresh. That is
 * the safe direction twice over: an older client that does not send `at` goes
 * quiet instead of becoming permanently present, and a peer cannot pin itself to
 * the roster forever by omitting the field.
 */
function freshestJoin(entries: unknown, now: number): number | null {
  if (!Array.isArray(entries)) return null
  let best: number | null = null
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const at = believableAt(entry.at, now)
    if (at === null) continue
    if (best === null || at > best) best = at
  }
  return best
}

/**
 * Reduce the roster and the node claims to what the sidebar and header need.
 *
 * `selfId` is the signed-in account id and is excluded on the presence KEY, not on
 * a payload field: the key is what Realtime dedupes devices by, so keying the
 * exclusion anywhere else would let your own second device appear as a stranger
 * standing on your tab.
 */
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

    const joinedAt = freshestJoin(entries, now)
    const claim = isRecord(nodes[userId]) ? (nodes[userId] as Record<string, unknown>) : null
    const claimAt = claim ? believableAt(claim.at, now) : null

    // Liveness comes from EITHER source, and it needs both. The heartbeat is a
    // broadcast, so a live peer refreshes `claimAt` every minute — but somebody
    // who joined a second ago has no broadcast yet, and counting only broadcasts
    // would leave them out of "N here now" until their first one lands (or
    // forever, if it is the one that gets lost). Presence says they are here; that
    // is enough to count them, on no tab.
    const freshest = Math.max(joinedAt ?? -Infinity, claimAt ?? -Infinity)
    if (!Number.isFinite(freshest) || now - freshest > ttlMs) continue

    // The DOT, though, comes only from a fresh broadcast. A claim older than the
    // TTL is released rather than left hanging on a page they may have left.
    const located = claimAt !== null && now - claimAt <= ttlMs
    const nodeId =
      located && typeof claim?.nodeId === 'string' && claim.nodeId ? claim.nodeId : null

    people.push({ userId, nodeId })
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
