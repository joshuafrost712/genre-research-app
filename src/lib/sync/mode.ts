/**
 * The in-room escape hatch: `?sync=live|poll|off`.
 *
 * The cheapest insurance in the whole sync build. If something misbehaves in a
 * workshop, this changes the app's behaviour on the spot, with no deploy, no
 * network beyond loading the page, and no code change to review at 9am in a
 * country twelve hours from a laptop that can build.
 *
 *   ?sync=live   websocket nudges plus the poll (the default)
 *   ?sync=poll   the poll only; use if Realtime is misbehaving
 *   ?sync=off    local only; every device keeps working and keeps its outbox,
 *                so nothing is lost and turning sync back on flushes it
 *
 * The choice is remembered, so it survives a reload and a PWA relaunch. Reaching
 * it needs a URL, which is deliberate: this is a facilitator's tool, not a
 * setting for someone to find and change by accident mid-session.
 */
import { db } from '../storage/db'

export type SyncMode = 'live' | 'poll' | 'off'

const KEY = 'syncMode'
const VALID: SyncMode[] = ['live', 'poll', 'off']

let current: SyncMode = 'live'

/** Read `?sync=` once at boot, persist it, and load the remembered value. */
export async function initSyncMode(): Promise<SyncMode> {
  let requested: SyncMode | null = null
  try {
    const raw = new URLSearchParams(window.location.search).get('sync')
    if (raw && (VALID as string[]).includes(raw)) requested = raw as SyncMode
  } catch {
    /* no URL in a non-browser context */
  }

  if (requested) {
    await db.meta.put({ key: KEY, value: requested })
    current = requested
    return current
  }

  const stored = (await db.meta.get(KEY))?.value
  current = stored && (VALID as string[]).includes(stored) ? (stored as SyncMode) : 'live'
  return current
}

export function syncMode(): SyncMode {
  return current
}

export async function setSyncMode(mode: SyncMode): Promise<void> {
  current = mode
  await db.meta.put({ key: KEY, value: mode })
}
