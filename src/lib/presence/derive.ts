/**
 * Turning raw Realtime presence state into "who is on which tab".
 *
 * Pure, and deliberately the only part of presence with tests. The channel
 * lifecycle needs two browsers to say anything true about it, but every rule that
 * decides what a person SEES lives here: one dot per person rather than per
 * device, never a dot for yourself, and a stale claim released rather than left
 * hanging on a tab nobody is on.
 *
 * PRESENCE STATE IS REMOTE INPUT. Every field arrives from another browser, which
 * means another version of this app, or a tab that has been asleep for an hour, or
 * (inside a team) somebody typing into a console. So nothing here trusts a shape:
 * a payload that is not what we expect reduces to "that person is not here",
 * because the failure that matters is a thrown exception blanking the sidebar, not
 * a missing dot.
 */

/**
 * How long a tracked claim stays believable.
 *
 * Realtime removes a presence entry when its socket closes, so this is not the
 * main mechanism — it is the second expiry the collaborative-data protocol asks
 * for, covering the case the transport cannot see: a phone whose tab was frozen
 * by the OS with the socket still nominally open. The direction of failure is the
 * point. A stale claim EXPIRES, so presence fails open (no dot, which is exactly
 * the app as it was last week) rather than pinning a ghost to a tab.
 */
export const PRESENCE_TTL_MS = 180_000

/**
 * How often a client re-announces itself. Must stay well under the TTL above, or
 * a person sitting still on one page ages out of their own tab. Three heartbeats
 * inside one TTL means two can be lost to a flaky venue wifi without a dot
 * flickering.
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
 * for a decoration, and the arithmetic is what caught it. The trade bought back is
 * that a frozen phone's dot can linger up to three minutes; a CLOSED tab still
 * disappears at once, because that path is the socket's, not this timer's.
 */
export const PRESENCE_HEARTBEAT_MS = 60_000

/** What this app tracks about itself on the channel. Keep it small; it is broadcast. */
export interface PresencePayload {
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
   * `people` and in no bucket here, which is how "3 here" can sit above a
   * sidebar showing only two dots without either number being wrong.
   */
  byNode: Map<string, PresencePerson[]>
}

const EMPTY: PresenceSnapshot = { people: [], byNode: new Map() }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * The freshest usable entry for one account, or null if it has none.
 *
 * An entry with no parseable `at` counts as STALE rather than as fresh. That is
 * the safe direction twice over: an older client that does not send `at` goes
 * quiet instead of becoming permanently present, and a peer cannot pin itself to
 * a tab forever by omitting the field.
 */
function freshest(entries: unknown, now: number, ttlMs: number): PresencePerson['nodeId'] | undefined {
  if (!Array.isArray(entries)) return undefined
  let bestAt = -Infinity
  let bestNode: string | null = null
  let found = false

  for (const entry of entries) {
    if (!isRecord(entry)) continue
    const at = typeof entry.at === 'string' ? Date.parse(entry.at) : NaN
    if (!Number.isFinite(at)) continue
    // Clamp a clock from the future to "now". Workshop device clocks are wrong by
    // minutes in both directions, and a fast clock must not buy a longer life
    // than a correct one.
    const age = Math.max(0, now - at)
    if (age > ttlMs) continue
    if (at > bestAt) {
      bestAt = at
      bestNode = typeof entry.nodeId === 'string' && entry.nodeId ? entry.nodeId : null
    }
    found = true
  }

  return found ? bestNode : undefined
}

/**
 * Reduce `channel.presenceState()` to what the sidebar and the header need.
 *
 * `selfId` is the signed-in account id and is excluded on the key, not on the
 * payload: the key is what Realtime dedupes devices by, so keying the exclusion
 * anywhere else would let your own second device appear as a stranger standing on
 * your tab.
 */
export function derivePresence(
  raw: unknown,
  opts: { selfId: string | null; now?: number; ttlMs?: number },
): PresenceSnapshot {
  if (!isRecord(raw)) return EMPTY
  const now = opts.now ?? Date.now()
  const ttlMs = opts.ttlMs ?? PRESENCE_TTL_MS

  const people: PresencePerson[] = []
  for (const [userId, entries] of Object.entries(raw)) {
    if (!userId || userId === opts.selfId) continue
    const nodeId = freshest(entries, now, ttlMs)
    if (nodeId === undefined) continue
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
