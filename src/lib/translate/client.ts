/**
 * Client side of answer translation.
 *
 * Three paths, tried in order of immediacy, mirroring the degrade ladder that
 * `devfeedback/send.ts` already uses for feedback:
 *
 *   1. Local dev endpoint — under `vite dev`, POST to `/__translate`, which proxies
 *      to Anthropic using a key from the developer's environment. Lets the whole
 *      feature be built and demoed with no deployed function.
 *   2. Deployed proxy — POST to VITE_TRANSLATE_URL (the Supabase Edge Function),
 *      authenticated with the caller's Supabase JWT.
 *   3. Deferred queue — if neither is reachable, or the app is configured for the
 *      zero-metered-cost lane, record the request locally for the Max-subscription
 *      worker to pick up.
 *
 * This never throws and never blocks a save. A failed translation leaves the
 * answer in its original language, which is a degraded view rather than lost work.
 */
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { isBetaMode } from '../../devfeedback/enabled'
import type { Locale } from '../i18n/locales'
import { INTERACTIVE_TIMEOUT_MS, TRANSLATE_LANE, TRANSLATE_URL } from './config'
import { enqueueTranslation } from './queue'

export type TranslateStatus = 'translated' | 'unchanged' | 'queued' | 'failed'

/**
 * Why a translation was deferred instead of returned, as a stable code.
 *
 * The UI has to explain this to a facilitator standing in front of a team, and
 * "Queued." on its own is not an explanation: being signed out is something they
 * can fix in ten seconds, while the key not being configured is not. Matching on
 * the proxy's English error prose would break the moment that prose is reworded,
 * so the cause is derived from the HTTP status here, once.
 */
export type QueuedCause =
  /** No Supabase session, but a sign-in control is on screen (401). */
  | 'signed-out'
  /** No Supabase session and this view offers no way to get one (401). */
  | 'needs-tester-link'
  /** No proxy URL in this build, or the proxy has no model key (503). */
  | 'not-configured'
  /** Rate limited (429). */
  | 'busy'
  /** Network unreachable, or slower than the interactive deadline. */
  | 'offline'
  /** This build deliberately prefers the deferred lane. */
  | 'lane'
  | 'unknown'

export interface TranslateOutcome {
  status: TranslateStatus
  /** Present when status is 'translated' or 'unchanged'. */
  text?: string
  /** Set on 'failed', for logging rather than display. */
  reason?: string
  /** Set on 'queued': what the UI should tell the person who pressed the button. */
  cause?: QueuedCause
  /** Round-trip milliseconds, for the latency budget check during the pilot. */
  ms?: number
}

/** Exported for testing: the status-to-explanation table, in one place. */
export function queuedCauseForStatus(status: number): QueuedCause {
  if (status === 401 || status === 403) {
    // The proxy identifies callers by Supabase JWT, and the only place the app
    // offers a Supabase sign-in is the beta-tester header control. On the plain
    // URL there is nothing to press, so telling someone to "sign in" would send
    // them looking for a button that is not there.
    return isSupabaseConfigured() && isBetaMode() ? 'signed-out' : 'needs-tester-link'
  }
  if (status === 429) return 'busy'
  if (status === 503) return 'not-configured'
  return 'unknown'
}

export interface TranslateArgs {
  /** The answer to translate, in its stored (source) language. */
  text: string
  targetLocale: Locale
  /**
   * The language the answer is already in. Optional for the Anthropic engine,
   * which reads it from the prompt's framing, but it matters for Google: a
   * glossary requires an explicit source language, and auto-detection on a
   * three-word cell answer is exactly where detection guesses wrong.
   */
  sourceLocale?: Locale
  /** English worksheet question this answers; context only, never translated. */
  question?: string
  /** Entry to attach a deferred result to, if this falls through to the queue. */
  entryId?: string
}

async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * POST with a hard deadline. A slow network must degrade into a deferred
 * translation, not a spinner the facilitator watches while a room waits.
 */
async function postWithDeadline(url: string, body: unknown, token?: string | null) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), INTERACTIVE_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function readOutcome(res: Response, started: number): Promise<TranslateOutcome> {
  const data = (await res.json().catch(() => ({}))) as {
    translation?: string
    unchanged?: boolean
    error?: string
  }
  if (!res.ok || !data.translation?.trim()) {
    return { status: 'failed', reason: data.error ?? `HTTP ${res.status}`, ms: Date.now() - started }
  }
  return {
    status: data.unchanged ? 'unchanged' : 'translated',
    text: data.translation,
    ms: Date.now() - started,
  }
}

export async function translateText(args: TranslateArgs): Promise<TranslateOutcome> {
  const { text, targetLocale, sourceLocale, question, entryId } = args
  if (!text.trim()) return { status: 'failed', reason: 'empty text' }

  const payload = { text, targetLocale, sourceLocale, question }
  const started = Date.now()

  // Configured for the zero-cost lane: do not attempt an interactive call at all.
  if (TRANSLATE_LANE === 'deferred') {
    await enqueueTranslation({ ...args })
    return { status: 'queued', cause: 'lane' }
  }

  if (import.meta.env.DEV) {
    try {
      const res = await postWithDeadline(`${import.meta.env.BASE_URL}__translate`, payload)
      // 501 means the dev endpoint exists but has no key configured; fall through
      // rather than reporting a failure the developer cannot act on from the UI.
      if (res.status !== 404 && res.status !== 501) return await readOutcome(res, started)
    } catch {
      // dev endpoint unreachable or timed out — fall through
    }
  }

  if (TRANSLATE_URL) {
    try {
      const res = await postWithDeadline(TRANSLATE_URL, payload, await accessToken())
      if (res.ok) return await readOutcome(res, started)
      // 401/429/5xx: queue it so the answer still gets translated eventually.
      await enqueueTranslation({ ...args })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      return {
        status: 'queued',
        reason: data.error ?? `HTTP ${res.status}`,
        cause: queuedCauseForStatus(res.status),
      }
    } catch (err) {
      await enqueueTranslation({ ...args })
      return { status: 'queued', reason: String(err), cause: 'offline' }
    }
  }

  // No proxy configured at all.
  if (entryId) {
    await enqueueTranslation({ ...args })
    return { status: 'queued', reason: 'no translation endpoint configured', cause: 'not-configured' }
  }
  return { status: 'failed', reason: 'no translation endpoint configured' }
}
