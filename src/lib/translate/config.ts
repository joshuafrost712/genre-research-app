/**
 * Translation runtime configuration.
 *
 * Two lanes translate the answers a team types, and they exist because the
 * requirements pull in opposite directions:
 *
 *  - LANE A (interactive): a Supabase Edge Function calling Haiku with a metered
 *    key. The only lane that can hit the "at most two seconds" target, because the
 *    app awaits a single HTTP round trip.
 *  - LANE B (deferred): a worker on the operator's own machine, authenticated by a
 *    Claude Max subscription, polling for untranslated answers and writing results
 *    back. Zero metered cost, but asynchronous by construction — a poll interval
 *    plus agent startup is seconds to a minute, not under two.
 *
 * `VITE_TRANSLATE_LANE` picks which one the app prefers. Lane A still falls back to
 * Lane B's queue whenever the proxy is unreachable (offline, key missing, rate
 * limited), so no answer is ever silently dropped and the app keeps working with
 * English as the floor.
 */
import { SOURCE_LOCALE, isLocale, type Locale } from '../i18n/locales'

export type TranslateLane = 'interactive' | 'deferred'

function readLane(): TranslateLane {
  const raw = import.meta.env.VITE_TRANSLATE_LANE as string | undefined
  return raw === 'deferred' ? 'deferred' : 'interactive'
}

/** Which lane the app tries first. */
export const TRANSLATE_LANE: TranslateLane = readLane()

/**
 * Lane A endpoint (the deployed Supabase Edge Function), injected at build time.
 * Unset in local dev, where the Vite `/__translate` endpoint stands in, and unset
 * in any build that has not configured a proxy — in which case the app degrades to
 * the deferred queue rather than erroring.
 */
export const TRANSLATE_URL = import.meta.env.VITE_TRANSLATE_URL as string | undefined

/**
 * Client-side deadline for an interactive translation. Past this the request is
 * abandoned and the answer is queued for Lane B, so a slow network degrades into a
 * late translation rather than a hung input. Deliberately under the 2s product
 * target to leave room for render.
 */
export const INTERACTIVE_TIMEOUT_MS = 1800

/**
 * Which language answers are translated into when the UI itself is in English.
 * A facilitator working in English still wants a team's Indonesian answers
 * rendered, and vice versa.
 */
export const DEFAULT_TRANSLATION_TARGET: Locale = (() => {
  const raw = import.meta.env.VITE_TRANSLATE_DEFAULT_TARGET as string | undefined
  if (isLocale(raw) && raw !== SOURCE_LOCALE) return raw
  return 'id'
})()
