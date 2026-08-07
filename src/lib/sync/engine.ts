/**
 * Sync engine: pushes the outbox and pulls every synced project, on a short
 * debounce after a local write and on a steady interval.
 *
 * It runs on the Supabase session, not on Google. Nothing here needs a Google
 * account, a Drive scope, or an OAuth consent screen.
 *
 * The poll is unconditional and is the product. Realtime, when it lands, only
 * nudges this same cycle to run sooner. That ordering is deliberate: a websocket
 * fails SILENTLY (the socket stays "subscribed" and simply stops delivering once
 * its token goes stale), so a poll that only ran when Realtime reported itself
 * down could never rescue a Realtime that was lying. A poll that always runs can.
 *
 * Everything is network-optional: a failed cycle leaves the outbox intact and
 * retries on the next tick, on `online`, or when the tab is focused again.
 */
import { useSyncExternalStore } from 'react'
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { onEnqueue, pendingCount } from './outbox'
import { getAuthorId } from './author'
import { pushOutbox } from './supabase/push'
import { pullProject } from './supabase/pull'
import {
  publishActiveIfWorked,
  publishOwnProjects,
  syncedProjectIds,
  invalidateProjectCache,
} from './supabase/projects'
import { adoptBestProject } from './adopt'
import { getActiveProjectId } from '../storage/appState'
import { initSyncMode, syncMode } from './mode'
import { rememberAccount } from '../supabase/accountMemory'
import { requestPersistentStorage } from '../storage/persist'
import { getDataOwner, isDifferentPerson, setDataOwner } from '../storage/owner'
import { resetLocalData } from '../storage/reset'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signed-out' | 'paused'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt: string | null
  error: string | null
  /** Outbox depth. A number the status chip can show, because a dot can lie. */
  pending: number
  /** Other devices seen in the synced projects this session. */
  peers: number
}

let status: SyncStatus = {
  state: isSupabaseConfigured() ? 'signed-out' : 'idle',
  lastSyncedAt: null,
  error: null,
  pending: 0,
  peers: 0,
}
const subscribers = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const cb of subscribers) cb()
}

let running = false
let bootstrapped = false
const peersSeen = new Set<string>()
/** Projects the server refused; stop retrying until the next sign-in. */
const forbidden = new Set<string>()

async function syncOnce(): Promise<void> {
  if (running || !supabase) return
  if (syncMode() === 'off') {
    // Local-only by request. Writes keep queueing in the outbox, so turning sync
    // back on later flushes everything rather than losing the session's work.
    setStatus({ state: 'paused', pending: await pendingCount() })
    return
  }

  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    setStatus({ state: 'signed-out', pending: await pendingCount() })
    return
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus({ state: 'offline', pending: await pendingCount() })
    return
  }

  running = true
  setStatus({ state: 'syncing', error: null })
  try {
    const authorId = await getAuthorId()

    // First cycle after sign-in. ORDER IS LOAD-BEARING: pull, adopt, then publish.
    //
    // Publishing first looks harmless and is not. On a second device the active
    // project is the throwaway starter this browser made seconds ago; publish it
    // first and it lands in the synced set before adoption has had a chance to
    // look, which is how a person ends up staring at an empty worksheet with
    // their real answers one project over, fully downloaded and invisible.
    //
    // So: find out what the account already holds, bring it down, decide where
    // this device should be pointed, and only then offer anything local upward.
    if (!bootstrapped) {
      const existing = await syncedProjectIds(true)
      for (const id of existing) await pullProject(id, authorId)
      await adoptBestProject(await getActiveProjectId(), existing)
      await publishOwnProjects()
      bootstrapped = true
    }

    const ids = await syncedProjectIds()
    for (const id of forbidden) ids.delete(id)

    // A starter earns its place in the cloud as soon as someone works in it.
    // Nothing is published on sign-in any more, so this is what carries a
    // brand-new account's very first passage up. Before the push, so the work
    // and the project it belongs to travel in the same cycle.
    if (await publishActiveIfWorked(await getActiveProjectId(), ids)) {
      for (const id of await syncedProjectIds(true)) if (!forbidden.has(id)) ids.add(id)
    }

    const result = await pushOutbox(ids)
    for (const id of result.forbidden) {
      forbidden.add(id)
      ids.delete(id)
    }
    if (result.forbidden.length) invalidateProjectCache()

    for (const id of ids) {
      const pulled = await pullProject(id, authorId)
      for (const a of pulled.authors) peersSeen.add(a)
    }

    await adoptBestProject(await getActiveProjectId(), ids)

    setStatus({
      state: 'idle',
      lastSyncedAt: new Date().toISOString(),
      pending: await pendingCount(),
      peers: peersSeen.size,
    })
  } catch (e) {
    setStatus({
      state: 'error',
      error: e instanceof Error ? e.message : 'Sync failed.',
      pending: await pendingCount(),
    })
  } finally {
    running = false
  }
}

/**
 * 300ms, not the 3s the Drive version used. End-to-end latency is this plus the
 * peer's poll, so every millisecond here is paid twice in the room.
 */
const FLUSH_DEBOUNCE_MS = 300
const PULL_INTERVAL_MS = 3_000

let started = false
let interval: number | null = null
let debounce: number | null = null
let unsubEnqueue: (() => void) | null = null
let unsubAuth: (() => void) | null = null

function onOnline(): void {
  void syncOnce()
}
function onVisible(): void {
  if (document.visibilityState === 'visible') void syncOnce()
}
function onBeforeUnload(): void {
  void syncOnce() // best-effort final flush
}

function attach(): void {
  if (interval !== null) return
  unsubEnqueue = onEnqueue(() => {
    void pendingCount().then((pending) => setStatus({ pending }))
    if (debounce) window.clearTimeout(debounce)
    debounce = window.setTimeout(() => void syncOnce(), FLUSH_DEBOUNCE_MS)
  })
  interval = window.setInterval(() => void syncOnce(), PULL_INTERVAL_MS)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('beforeunload', onBeforeUnload)
}

function detach(): void {
  if (interval) {
    window.clearInterval(interval)
    interval = null
  }
  if (debounce) {
    window.clearTimeout(debounce)
    debounce = null
  }
  unsubEnqueue?.()
  unsubEnqueue = null
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('beforeunload', onBeforeUnload)
}

/**
 * Everything that must happen on arrival at a signed-in state, whichever route
 * got us here (fresh sign-in, restored session, token refresh).
 *
 * Returns true if the device is being reset for a different account, in which
 * case a reload is already in flight and the caller must NOT start syncing. That
 * ordering is the entire fix for the account-switch bug: the first cycle after
 * sign-in publishes local projects under the new `auth.uid()`, so if a cycle can
 * start before ownership has been settled, one person's worksheets land in
 * another person's account. Ownership is therefore decided before `attach()`,
 * not alongside it.
 *
 * The marker is what lets a later boot tell "your session went missing" apart
 * from "you have never signed in" — see `supabase/accountMemory.ts`.
 *
 * The persistence request is repeated rather than done once at startup because
 * Chrome grants it on engagement heuristics that a just-opened app may not meet
 * yet, and a signed-in user is exactly the signal it is looking for.
 */
let signedInFlight: Promise<boolean> | null = null

function onSignedIn(user: { id: string; email?: string } | undefined): Promise<boolean> {
  // Single-flight, the same shape `ensureActiveContext` uses. Two routes reach
  // here at boot — the explicit getSession() below and the listener's
  // INITIAL_SESSION — and on an account switch both would otherwise run the wipe
  // and call reload(), burning the reload guard on a duplicate of itself.
  if (signedInFlight) return signedInFlight
  signedInFlight = resolveOwnership(user)
  const clear = () => {
    signedInFlight = null
  }
  signedInFlight.then(clear, clear)
  return signedInFlight
}

async function resolveOwnership(user: { id: string; email?: string } | undefined): Promise<boolean> {
  if (!user?.id) return false
  const email = user.email ?? ''

  const owner = await getDataOwner()
  if (isDifferentPerson(owner, user.id, email)) {
    await resetLocalData({ id: user.id, email })
    return true
  }
  // Unstamped means unclaimed: a brand-new device, or one from before this
  // existed. Claiming it is what keeps "worked offline, then signed in" working
  // — that person's local project is theirs and should still be published.
  if (!owner.uid) await setDataOwner(user.id, email)

  if (email) rememberAccount(email)
  void requestPersistentStorage()
  return false
}

export const syncEngine = {
  /**
   * Idempotent. Mounted unconditionally: with no Supabase configured it does
   * nothing, and while signed out it waits for the auth event rather than
   * needing the sign-in path to remember to call it.
   */
  async start(): Promise<void> {
    if (started || !supabase) return
    started = true

    // Before anything else, so a facilitator's ?sync=off is honoured on the very
    // first cycle rather than after one round of syncing they asked not to have.
    await initSyncMode()

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        bootstrapped = false
        peersSeen.clear()
        forbidden.clear()
        invalidateProjectCache()
        detach()
        setStatus({ state: 'signed-out', peers: 0, lastSyncedAt: null })
        // Deliberately does NOT forget the account marker. This event fires for a
        // dropped session as well as a chosen sign-out, and only `signOutBeta`
        // knows which one this was.
        return
      }
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        // Awaited, not fire-and-forget: nothing may sync until we know whose
        // data this is. A reset returns true and a reload is already coming.
        void onSignedIn(session?.user).then((reset) => {
          if (reset) return
          attach()
          void syncOnce()
        })
      }
    })
    unsubAuth = () => sub.subscription.unsubscribe()

    // onAuthStateChange fires INITIAL_SESSION on subscribe, but only once the
    // stored session has been read. Kick a cycle for the already-signed-in case.
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      if (await onSignedIn(data.session.user)) return
      attach()
      void syncOnce()
    } else {
      setStatus({ state: 'signed-out', pending: await pendingCount() })
    }
  },

  stop(): void {
    started = false
    detach()
    unsubAuth?.()
    unsubAuth = null
  },

  /** Force a cycle now (after publishing, joining, or a manual retry). */
  syncNow(): void {
    void syncOnce()
  },
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => status,
    () => status,
  )
}
