/**
 * The presence channel: one private Realtime channel per shared project, telling
 * the team where each of its members is.
 *
 * TWO TRANSPORTS ON ONE CHANNEL, and the split is not decoration.
 *
 * - `track()` (presence) runs ONCE per join and answers "who is here". Realtime
 *   removes the entry the instant the socket closes, which is what makes a closed
 *   tab disappear immediately rather than after a timeout.
 * - `send({type:'broadcast', event:'node'})` answers "where are they", on every
 *   navigation and on a slow heartbeat.
 *
 * Navigation used to be a `track()` too, and that is what stopped this shipping
 * the first time. Realtime enforces a per-client presence rate limit that does not
 * drop the offending event — it sends `phx_close` and the channel is gone.
 * Measured on this project: killed on the sixth `track()` at any interval up to
 * five seconds. realtime-js does not rejoin a server-initiated close, so presence
 * died about a minute into ordinary use, silently, because an empty room and a
 * dead channel look identical. Broadcast is governed by `max_events_per_second`
 * (100), verified at 40 sends in 18 seconds with the channel untouched.
 *
 * So: KEEP PRESENCE OFF THE HOT PATH. Anything that happens per navigation must be
 * a broadcast. If a future change needs to put something in the presence payload,
 * it needs to answer how often that payload changes first.
 *
 * Module state rather than component state, for the same reason the sync engine is
 * a module: sign-out has to be able to tear this down from `sync/engine.ts`, which
 * is nowhere near the React tree.
 *
 * Everything here degrades to nothing. No Supabase configured, signed out, a
 * personal project that was never published, `?sync=poll` — each is a no-op, not
 * an error path, exactly as `outbox.ts` and the sync engine already behave.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../supabase/client'
import { initSyncMode } from '../sync/mode'
import {
  PRESENCE_HEARTBEAT_MS,
  type NodeClaim,
  type NodePayload,
  type PresenceInput,
} from './derive'

/** Debounce on re-announcing after a route change, so walking the nav is quiet. */
const TRACK_DEBOUNCE_MS = 500

/**
 * How long to gather new arrivals before re-announcing to them.
 *
 * Broadcast is fire-and-forget: somebody who joins after we last moved hears
 * nothing and would show us on no tab. So every peer re-announces when it sees a
 * join — coalesced, because a room coming back from a wifi drop produces a burst
 * of joins and each one does not deserve its own message.
 */
const REANNOUNCE_COALESCE_MS = 400

type Listener = (state: PresenceInput) => void

const listeners = new Set<Listener>()

let presenceState: unknown = {}
/** userId -> where we last heard they were, stamped with OUR clock. */
let nodeState: Record<string, NodeClaim> = {}

let channel: RealtimeChannel | null = null
/** `${projectId}:${userId}` of the channel we are on, or null. */
let joinedKey: string | null = null
let selfId: string | null = null
let node: string | null = null
let heartbeat: number | null = null
let debounce: number | null = null
let reannounce: number | null = null
/** What to rejoin, and how many times we have tried since the last success. */
let rejoinTarget: { projectId: string; userId: string } | null = null
let rejoinTimer: number | null = null
let rejoinAttempts = 0

/**
 * Backoff for rejoining after the SERVER closed the channel.
 *
 * realtime-js reconnects a dropped socket by itself; what it does not do is rejoin
 * after a server-initiated `phx_close`, and the previous version of this file only
 * cleared `joinedKey` and called that a fix. It was not: the provider's join effect
 * depends on `[projectId, userId]`, neither of which changes, so nothing ever ran
 * again and presence was dead for the session while looking exactly like an empty
 * room. Bounded, because the other reason a private channel closes is that this
 * account is not authorised for the topic, and retrying that forever is a loop
 * nobody asked for.
 */
const REJOIN_BACKOFF_MS = [5_000, 15_000, 60_000]
/**
 * Bumped on every join or leave. `joinPresence` awaits twice before it subscribes,
 * so without this a fast project switch can leave the older call finishing after
 * the newer one and pinning the channel to the project you just left.
 */
let generation = 0

/** Subscribe to channel state. The callback fires immediately with what we have. */
export function onPresenceState(cb: Listener): () => void {
  listeners.add(cb)
  cb(snapshot())
  return () => {
    listeners.delete(cb)
  }
}

function snapshot(): PresenceInput {
  return { presence: presenceState, nodes: nodeState }
}

function publish(): void {
  const next = snapshot()
  for (const cb of listeners) cb(next)
}

/**
 * Send where we are. Fire and forget; the next heartbeat repairs a lost one.
 *
 * REQUIRES A JOINED CHANNEL, and that is not belt-and-braces. realtime-js's
 * `send()` checks `canPush()` and, for a broadcast on a channel that cannot push,
 * silently falls back to an HTTP POST to the broadcast endpoint plus a deprecation
 * warning (`RealtimeChannel.js:514`). So a navigation during the subscribe
 * handshake, or any navigation after a channel death, would quietly leave the
 * websocket for a REST call per keystroke-ish event. `leavePresence` already
 * guards the same way on teardown.
 */
function announce(): void {
  if (!channel || channel.state !== 'joined' || !selfId) return
  const payload: NodePayload = { userId: selfId, nodeId: node, at: new Date().toISOString() }
  void channel
    .send({ type: 'broadcast', event: 'node', payload })
    // A failed announcement costs one heartbeat of being on the wrong tab, and the
    // next one fixes it. Surfacing it would be a spinner on a decoration.
    .catch(() => {})
}

/**
 * Where this device is now. Cheap to call on every route change.
 *
 * Debounced rather than immediate: tapping down a stage in the sidebar produces
 * several route changes in a second, and each one would otherwise be a message to
 * everybody in the room.
 */
export function setPresenceNode(nodeId: string | null): void {
  node = nodeId
  if (!channel) return
  if (debounce) window.clearTimeout(debounce)
  debounce = window.setTimeout(announce, TRACK_DEBOUNCE_MS)
}

/**
 * Join the team's presence channel, or do nothing.
 *
 * `private: true` IS LOAD-BEARING AND IS NOT THE DEFAULT. realtime-js defaults it
 * to false, and it is what becomes the `private=true` join parameter; RLS on
 * `realtime.messages` is consulted for private channels only. Drop this flag and
 * the whole authorization migration is inert while appearing to be in force —
 * anyone holding the public anon key and a project uuid could read a team's
 * presence, and now its broadcasts too. There is no error to notice, because a
 * public channel works.
 */
export async function joinPresence(projectId: string, userId: string): Promise<void> {
  const key = `${projectId}:${userId}`
  if (joinedKey === key) return
  const gen = ++generation

  leavePresence({ keepGeneration: true })
  if (!supabase) return

  // `?sync=poll` is the facilitator's escape hatch when realtime misbehaves in a
  // room, and presence is the first feature that makes the distinction real. Awaited
  // here rather than read from module state because `syncMode()` answers 'live'
  // until the stored value has been loaded, and this provider mounts in that window.
  if ((await initSyncMode()) !== 'live') return
  if (gen !== generation) return

  const ch = supabase.channel(`presence:${projectId}`, {
    config: {
      private: true,
      presence: { key: userId },
      // Our own claim is already in `node`; echoing it back would only invite the
      // derive step to reason about excluding ourselves twice.
      broadcast: { self: false },
    },
  })

  // BEFORE subscribe, not after. realtime-js only sets `presence_enabled` in the
  // join payload when a presence binding already exists, so binding afterwards
  // joins a channel that will never deliver presence and looks like an empty room.
  ch.on('presence', { event: 'sync' }, () => {
    presenceState = ch.presenceState()
    publish()
  })

  // Somebody new can only learn where we are if we tell them, because broadcast
  // keeps no history. Coalesced so a room reconnecting together costs one message.
  ch.on('presence', { event: 'join' }, ({ key: joinedId }) => {
    if (joinedId === userId) return
    if (reannounce) window.clearTimeout(reannounce)
    reannounce = window.setTimeout(announce, REANNOUNCE_COALESCE_MS)
  })

  // THERE IS DELIBERATELY NO `leave` HANDLER, and that is a bug fix rather than an
  // omission. Dropping a peer's claim when they leave looks tidy and is actively
  // wrong: a reload is a leave and a join, the two arrive on different clocks, and
  // the presence diff is the slower of them. The reloading tab's first broadcast
  // lands about 600ms in, while the diff retiring its OLD entry can arrive a
  // second later — so the handler deleted a claim that had just arrived, and that
  // peer then showed no dot until their next navigation or the 60s heartbeat.
  //
  // Nothing needs cleaning up, because the roster is already the authority on who
  // is present: `derivePresence` ignores any claim whose account is not in the
  // presence state, so a claim left behind by someone who has gone is invisible,
  // and their own next broadcast overwrites it if they come back.

  ch.on('broadcast', { event: 'node' }, ({ payload }) => {
    if (!payload || typeof payload !== 'object') return
    const claim = payload as Partial<NodePayload>
    if (typeof claim.userId !== 'string' || !claim.userId) return
    if (claim.userId === userId) return
    // STAMPED WITH OUR OWN CLOCK, and the sender's `at` is deliberately ignored.
    // Ordering on a peer-supplied timestamp handed a workshop's worst device clock
    // — or any teammate with a console — control of both ordering and expiry: one
    // claim dated in the future beat every later claim from that account, and
    // never expired, so their dot stuck to the wrong node for the length of the
    // skew. Last-heard-wins on the local clock cannot be poisoned, and answers the
    // only question actually being asked.
    nodeState = {
      ...nodeState,
      [claim.userId]: {
        nodeId: typeof claim.nodeId === 'string' && claim.nodeId ? claim.nodeId : null,
        heardAt: Date.now(),
      },
    }
    publish()
  })

  channel = ch
  joinedKey = key
  selfId = userId
  rejoinTarget = { projectId, userId }

  ch.subscribe((status) => {
    if (gen !== generation) return
    if (status === 'SUBSCRIBED') {
      rejoinAttempts = 0
      // The single presence write of the whole session. Everything that happens
      // per navigation below this line is a broadcast; see the header comment.
      void ch.track({ at: new Date().toISOString() }).catch(() => {})
      announce()
      if (heartbeat) window.clearInterval(heartbeat)
      // The second half of the two-expiry rule in the collaborative-data protocol:
      // the socket's own disconnect handling covers a closed tab, and this covers a
      // tab the OS froze with the socket still nominally open. Without it, a person
      // reading one page quietly ages out of their own tab.
      heartbeat = window.setInterval(announce, PRESENCE_HEARTBEAT_MS)
      return
    }
    if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
      // Presence fails OPEN: no dots is the app as it shipped before this, so there
      // is nothing to tell anyone and nothing to put on screen. But the local state
      // has to be released rather than left pointing at a channel nobody is on, and
      // then the rejoin has to actually be attempted — see REJOIN_BACKOFF_MS for
      // why clearing `joinedKey` alone did nothing.
      if (heartbeat) {
        window.clearInterval(heartbeat)
        heartbeat = null
      }
      channel = null
      joinedKey = null
      presenceState = {}
      nodeState = {}
      publish()
      if (import.meta.env.DEV) {
        console.warn(`[presence] channel ${status} on presence:${projectId}`)
      }
      const backoff = REJOIN_BACKOFF_MS[rejoinAttempts]
      if (rejoinTarget && backoff !== undefined) {
        rejoinAttempts++
        if (rejoinTimer) window.clearTimeout(rejoinTimer)
        rejoinTimer = window.setTimeout(() => {
          rejoinTimer = null
          // The generation guard is the whole safety here: a sign-out or a project
          // switch between the close and this firing must not resurrect the old
          // channel.
          if (gen !== generation || !rejoinTarget) return
          void joinPresence(rejoinTarget.projectId, rejoinTarget.userId)
        }, backoff)
      }
    }
  })
}

/**
 * Leave, and forget. Called on unmount, on a project switch, and from the sync
 * engine on SIGNED_OUT — the channel is authorized by the session's JWT, so a
 * channel outliving the session is a socket nobody owns.
 *
 * SYNCHRONOUS ON PURPOSE, and nothing awaits the teardown. `untrack()` on a
 * channel sitting in `errored` never settles, so an awaiting version deadlocks
 * exactly when it is needed most: the refused-channel case, where a project switch
 * would wait forever for the previous channel to say goodbye and never join the
 * new one. Local state is cleared first and unconditionally, so the caller is free
 * the moment this returns.
 */
export function leavePresence(opts?: { keepGeneration?: boolean }): void {
  if (!opts?.keepGeneration) generation++
  for (const timer of [debounce, reannounce, rejoinTimer]) if (timer) window.clearTimeout(timer)
  debounce = null
  reannounce = null
  rejoinTimer = null
  if (!opts?.keepGeneration) {
    // A real teardown, not the one at the top of joinPresence: forget what we were
    // trying to get back to, so a sign-out cannot be followed by a reconnection.
    rejoinTarget = null
    rejoinAttempts = 0
  }
  if (heartbeat) {
    window.clearInterval(heartbeat)
    heartbeat = null
  }
  const ch = channel
  channel = null
  joinedKey = null
  selfId = null
  presenceState = {}
  nodeState = {}
  publish()
  if (!ch) return
  // Only a joined channel has presence to withdraw; on any other state the
  // removal below is the whole teardown.
  if (ch.state === 'joined') void ch.untrack().catch(() => {})
  void supabase?.removeChannel(ch).catch(() => {})
}
