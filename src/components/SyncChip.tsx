/**
 * The header sync indicator.
 *
 * It shows NUMBERS, not a coloured dot, and that is the whole design. The old dot
 * turned green on "the last cycle did not throw", which is true of a sync engine
 * that is replicating nothing at all: a wrong project filter, a stale token, a
 * websocket that stopped delivering, all render as a healthy green light. "2
 * waiting · 4s ago" cannot lie in the same way, and in a workshop room the
 * difference is between diagnosing a problem in seconds and guessing at it.
 *
 * It is also the only place a facilitator can see that a device is behind, which
 * is why it is in the header rather than behind a menu.
 */
import { useEffect, useState } from 'react'
import { syncEngine, useSyncStatus } from '../lib/sync/engine'

function ago(iso: string | null, nowMs: number): string {
  if (!iso) return 'never'
  const secs = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  return `${Math.round(secs / 3600)}h ago`
}

export function SyncChip() {
  const sync = useSyncStatus()
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Re-render on a slow tick so "4s ago" keeps counting while nothing else changes.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  if (sync.state === 'signed-out') return null

  // Stale means the poll has stopped running, which is a different and worse
  // problem than a cycle that failed loudly: nothing is on screen to say so.
  const stale =
    sync.state !== 'paused' &&
    sync.lastSyncedAt !== null &&
    nowMs - new Date(sync.lastSyncedAt).getTime() > 30_000

  const tone =
    sync.state === 'error' || stale
      ? 'border-red-300 bg-red-50 text-red-700'
      : sync.state === 'paused'
        ? 'border-gray-400 bg-gray-100 text-gray-700'
        : sync.state === 'offline'
          ? 'border-gray-300 bg-gray-50 text-gray-600'
          : sync.pending > 0 || sync.state === 'syncing'
            ? 'border-amber-300 bg-amber-50 text-amber-800'
            : 'border-emerald-300 bg-emerald-50 text-emerald-800'

  const label =
    sync.state === 'paused'
      ? 'Sync off'
      : sync.state === 'offline'
        ? 'Offline'
        : sync.state === 'error'
          ? 'Sync failed'
          : sync.pending > 0
            ? `${sync.pending} waiting`
            : 'Saved'

  const detail =
    sync.state === 'paused'
      ? `Local only (?sync=off). ${sync.pending} change${sync.pending === 1 ? '' : 's'} held for when it is back on.`
      : sync.state === 'error'
        ? (sync.error ?? 'unknown error')
        : `Last synced ${ago(sync.lastSyncedAt, nowMs)}${sync.peers > 0 ? ` · ${sync.peers} other device${sync.peers === 1 ? '' : 's'}` : ''}`

  return (
    <button
      type="button"
      onClick={() => syncEngine.syncNow()}
      title={`${detail}. Tap to sync now.`}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${tone}`}
    >
      <span className="font-medium">{label}</span>
      <span className="hidden sm:inline opacity-75">{ago(sync.lastSyncedAt, nowMs)}</span>
    </button>
  )
}
