/**
 * Sync engine: orchestrates flush + pull for the active scope. Runs only when
 * Google is configured AND a user is signed in. It flushes shortly after a local
 * write (debounced), pulls on an interval and on regaining focus/connectivity,
 * and exposes a status the header can show. Everything is network-optional: a
 * failed cycle leaves the outbox intact and retries next tick or on `online`.
 */
import { useSyncExternalStore } from 'react'
import { getAccessToken, isGoogleConfigured } from '../google/auth'
import { getAccount } from '../google/account'
import { backfillAll, onEnqueue } from './outbox'
import { getActiveScope } from './scope'
import { flush } from './flush'
import { pull } from './pull'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  state: SyncState
  lastSyncedAt: string | null
  error: string | null
}

let status: SyncStatus = { state: 'idle', lastSyncedAt: null, error: null }
const subscribers = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const cb of subscribers) cb()
}

let running = false

async function syncOnce(): Promise<void> {
  if (running || !isGoogleConfigured()) return
  if (!(await getAccount())) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus({ state: 'offline' })
    return
  }
  running = true
  setStatus({ state: 'syncing', error: null })
  try {
    const scope = await getActiveScope()
    // Team reads need the broad scope; pre-warm it so a silent token re-grant
    // after expiry/reload doesn't drop to drive.file (which can't see teammates).
    if (scope.kind === 'team') await getAccessToken('full')
    await flush(scope)
    await pull(scope)
    setStatus({ state: 'idle', lastSyncedAt: new Date().toISOString() })
  } catch (e) {
    setStatus({ state: 'error', error: e instanceof Error ? e.message : 'Sync failed.' })
  } finally {
    running = false
  }
}

const PULL_INTERVAL_MS = 45_000
const FLUSH_DEBOUNCE_MS = 3_000

let started = false
let interval: number | null = null
let debounce: number | null = null
let unsubEnqueue: (() => void) | null = null

function onOnline(): void {
  void syncOnce()
}
function onVisible(): void {
  if (document.visibilityState === 'visible') void syncOnce()
}
function onBeforeUnload(): void {
  void syncOnce() // best-effort final flush
}

export const syncEngine = {
  /** Idempotent: starts the loop once a configured user is signed in. */
  async start(): Promise<void> {
    if (started || !isGoogleConfigured()) return
    if (!(await getAccount())) return
    started = true

    await backfillAll()

    unsubEnqueue = onEnqueue(() => {
      if (debounce) window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void syncOnce(), FLUSH_DEBOUNCE_MS)
    })
    interval = window.setInterval(() => void syncOnce(), PULL_INTERVAL_MS)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('beforeunload', onBeforeUnload)

    void syncOnce()
  },

  stop(): void {
    started = false
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
    setStatus({ state: 'idle' })
  },

  /** Force a sync now (e.g. after creating/joining a team). */
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
