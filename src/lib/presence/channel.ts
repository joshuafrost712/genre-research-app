/**
 * The presence channel: one private Realtime channel per shared project, telling
 * the team where each of its members is.
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
import { PRESENCE_HEARTBEAT_MS, type PresencePayload } from './derive'

/** Debounce on re-announcing after a route change, so walking the nav is quiet. */
const TRACK_DEBOUNCE_MS = 500

type Listener = (raw: unknown) => void

const listeners = new Set<Listener>()
let latest: unknown = {}

let channel: RealtimeChannel | null = null
/** `${projectId}:${userId}` of the channel we are on, or null. */
let joinedKey: string | null = null
let node: string | null = null
let heartbeat: number | null = null
let debounce: number | null = null
/**
 * Bumped on every join or leave. `joinPresence` awaits twice before it subscribes,
 * so without this a fast project switch can leave the older call finishing after
 * the newer one and pinning the channel to the project you just left.
 */
let generation = 0

/** Subscribe to raw presence state. The callback fires immediately with what we have. */
export function onPresenceState(cb: Listener): () => void {
  listeners.add(cb)
  cb(latest)
  return () => {
    listeners.delete(cb)
  }
}

function publish(raw: unknown): void {
  latest = raw
  for (const cb of listeners) cb(raw)
}

function announce(): void {
  if (!channel) return
  const payload: PresencePayload = { nodeId: node, at: new Date().toISOString() }
  // Fire and forget. A failed announcement costs one heartbeat of invisibility and
  // the next one fixes it; surfacing it would be a spinner on a decoration.
  void channel.track(payload).catch(() => {})
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
 * presence. There is no error to notice, because a public channel works.
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
    config: { private: true, presence: { key: userId } },
  })

  // BEFORE subscribe, not after. realtime-js only sets `presence_enabled` in the
  // join payload when a presence binding already exists, so binding afterwards
  // joins a channel that will never deliver presence and looks like an empty room.
  ch.on('presence', { event: 'sync' }, () => publish(ch.presenceState()))

  channel = ch
  joinedKey = key

  ch.subscribe((status) => {
    if (gen !== generation) return
    if (status === 'SUBSCRIBED') {
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
      // Presence fails OPEN: no dots is the app as it shipped last week, so there
      // is nothing to tell anyone and nothing to retry by hand (realtime-js
      // reconnects on its own). The one case worth knowing about in development is
      // a refused private channel, which means the authorization migration has not
      // been applied to this project.
      publish({})
      if (import.meta.env.DEV) {
        console.warn(`[presence] channel ${status} on presence:${projectId}`)
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
  if (debounce) {
    window.clearTimeout(debounce)
    debounce = null
  }
  if (heartbeat) {
    window.clearInterval(heartbeat)
    heartbeat = null
  }
  const ch = channel
  channel = null
  joinedKey = null
  publish({})
  if (!ch) return
  // Only a joined channel has presence to withdraw; on any other state the
  // removal below is the whole teardown.
  if (ch.state === 'joined') void ch.untrack().catch(() => {})
  void supabase?.removeChannel(ch).catch(() => {})
}
