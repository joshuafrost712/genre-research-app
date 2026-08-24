/**
 * Whether the work on this device is actually safe, in a form the UI can act on.
 *
 * The failure this exists for: on 2026-08-24 a Bali workshop participant opened
 * the app from a WhatsApp link on an iPhone, typed notes on local music genres,
 * and then saw an empty app. Accounts of the mechanism differ (a reopened
 * browser, a private window, a dead battery) and it is deliberately NOT encoded
 * anywhere below — see the note on sniffing. What is established is the part this
 * module addresses: nothing ever told him his work was at risk, and there was no
 * way to get a copy off the device.
 *
 * `persist.ts` already asked the browser to keep our data and already knew the
 * answer was "no". The gap was that the answer was only ever rendered inside the
 * SIGNED-IN account menu, so the one person who most needed it — a guest with no
 * account and no cloud copy — could not see it. This module turns that answer
 * into a risk level, adds the two facts the level cannot carry on its own, and
 * exposes the whole thing as one hook.
 *
 * Three deliberate design choices, each of which took a wrong turn first:
 *
 * 1. **No private-browsing sniffing.** iOS exposes no reliable signal for it, and
 *    chasing one is beside the point: an ordinary non-installed Safari tab loses
 *    its data to WebKit's seven-day eviction rule whether or not it is private.
 *    `at-risk` is the honest condition, and treating "the browser refused to
 *    promise" as the trigger covers private windows, in-app browsers and plain
 *    tabs with one rule and no guesswork.
 *
 * 2. **`ephemeral` is only ever claimed when it is provable.** The tempting
 *    version — "no probe from a previous session, so this must be private mode" —
 *    fires on every genuinely-new user's first session too, and telling a first
 *    time user their work was deleted is worse than saying nothing. So loss is
 *    asserted only against a recorded high-water mark: we saw N answers here
 *    once, there are none now, and the device otherwise looks freshly minted.
 *
 * 3. **The high-water mark is refreshed as work happens, not just at startup.**
 *    Recording it only on load would have missed the case above entirely. A
 *    session's whole body of work can be typed between one startup and whatever
 *    ended it, so a mark written only at startup reads zero and proves nothing.
 *
 * A deliberate device clear (`reset.ts`) wipes every table including `meta`, so
 * the probe record goes with it and a handover can never be misread as eviction.
 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { getMetaValue, setMetaValue } from './appState'
import { storageDurability, type Durability } from './persist'

/**
 * - `protected`  the browser promised to keep this data. Nothing to warn about.
 * - `at-risk`    it refused. True for every non-installed Safari tab, every
 *                in-app browser and every private window.
 * - `ephemeral`  it refused AND work recorded here previously is gone.
 */
export type StorageRisk = 'protected' | 'at-risk' | 'ephemeral'

const PROBE_KEY = 'durabilityProbe'

interface ProbeRecord {
  /** Last session that wrote this record. */
  at: string
  /** Most answers + notes ever seen on this device. The loss test compares to it. */
  high: number
}

function parseProbe(raw: string | undefined): ProbeRecord | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const rec = parsed as Partial<ProbeRecord>
    if (typeof rec.high !== 'number') return null
    return { at: typeof rec.at === 'string' ? rec.at : '', high: rec.high }
  } catch {
    // A record from a future schema, or a truncated write. Treat as absent: the
    // cost is one missed loss report, versus a crash on every page load.
    return null
  }
}

/** Answers plus captured notes: the things a person typed and would mourn. */
async function countWork(): Promise<number> {
  const [entries, notes] = await Promise.all([db.entries.count(), db.capturedNotes.count()])
  return entries + notes
}

/**
 * Does this device look like it has never been used, as opposed to used and
 * emptied? Every browser mints one starter project, focus text and genre on
 * first run, so "freshly minted" is the baseline to compare a suspected wipe
 * against. Required before claiming loss, so that deleting your last project by
 * hand is not reported back to you as the browser eating it.
 */
async function looksFreshlyMinted(work: number): Promise<boolean> {
  return work === 0 && (await db.projects.count()) <= 1
}

/**
 * Read the previous session's mark, then stamp this one. Runs once per page load,
 * not once per mount: React StrictMode mounts twice in development, and a second
 * run would overwrite the record it is trying to read.
 */
let probeInFlight: Promise<boolean> | null = null

/**
 * One probe, uncached. Exported for tests, which need to play several sessions in
 * a row; application code wants `runSessionProbe` so that StrictMode's double
 * mount cannot make the second read see the first one's write.
 */
export async function probeSession(): Promise<boolean> {
  const prior = parseProbe(await getMetaValue(PROBE_KEY))
  const work = await countWork()
  const lost = prior !== null && prior.high > 0 && (await looksFreshlyMinted(work))
  // Carry the mark forward. After a real loss the mark resets to what is here
  // now, so the warning is shown once for that event rather than forever.
  const high = lost ? work : Math.max(work, prior?.high ?? 0)
  await setMetaValue(PROBE_KEY, JSON.stringify({ at: new Date().toISOString(), high }))
  return lost
}

export function runSessionProbe(): Promise<boolean> {
  if (probeInFlight) return probeInFlight
  probeInFlight = probeSession()
  return probeInFlight
}

/** Raise the high-water mark as the person works. See design note 3 above. */
export async function recordWorkLevel(work: number): Promise<void> {
  if (work <= 0) return
  const current = parseProbe(await getMetaValue(PROBE_KEY))
  if (current && current.high >= work) return
  await setMetaValue(PROBE_KEY, JSON.stringify({ at: new Date().toISOString(), high: work }))
}

/**
 * Is this a browser embedded inside another app, rather than Safari itself?
 *
 * It matters because an in-app browser is a separate storage jar: work typed in
 * WhatsApp's window is invisible in Safari and vice versa, and a link shared in a
 * chat is how most workshop participants arrive. iOS Safari always carries a
 * `Version/<n>` token; a plain WKWebView embedded in another app omits it.
 *
 * Third-party iOS browsers omit it too, and they are not the problem, so they are
 * excluded by name. This is a heuristic on a user-agent string: it may only
 * soften copy, and must never gate a feature.
 */
const IOS_BROWSER_BRANDS = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\//

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  if (!/iPhone|iPad|iPod/.test(ua)) return false
  if (IOS_BROWSER_BRANDS.test(ua)) return false
  return !/Version\/\d/.test(ua)
}

/** True when the app is running as an installed home-screen app. */
export function isStandalone(): boolean {
  // `navigator.standalone` is the iOS signal and is not in the DOM types.
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export interface StorageState {
  risk: StorageRisk
  /** Answers + notes on this device. Zero means there is nothing to warn about. */
  work: number
  inAppBrowser: boolean
  standalone: boolean
  /** False until the async checks have answered. Callers must not warn before it. */
  ready: boolean
}

export function useStorageState(): StorageState {
  const [durability, setDurability] = useState<Durability>('unknown')
  const [lost, setLost] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [d, hadLoss] = await Promise.all([storageDurability(), runSessionProbe()])
      if (!alive) return
      setDurability(d)
      setLost(hadLoss)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const work = useLiveQuery(countWork, [], undefined)

  // Keep the mark current so a power cut mid-session is still provable next time.
  useEffect(() => {
    if (work !== undefined) void recordWorkLevel(work)
  }, [work])

  const risk: StorageRisk =
    // `unknown` means the API is missing, not that we are safe, so it is not
    // treated as protected. It resolves to at-risk, which warns rather than
    // reassures — the right way round for a question about losing work.
    durability === 'protected' ? 'protected' : lost ? 'ephemeral' : 'at-risk'

  return {
    risk,
    work: work ?? 0,
    inAppBrowser: isInAppBrowser(),
    standalone: isStandalone(),
    ready: ready && work !== undefined,
  }
}
