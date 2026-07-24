/**
 * Feedback-mode gate. The in-app feedback tools mount in two distinct modes:
 *
 *   - `dev`  — the full developer affordance: highlight → comment, edit text in
 *     place, the manager, "send batch". On for any `vite dev` build, or any
 *     build where localStorage['genre.dev'] === '1' (set once with `?dev=1`).
 *   - `beta` — the external-tester affordance: highlight → comment ONLY (no
 *     text editing), plus a guided welcome + sign-in. Turned on for a build
 *     where localStorage['genre.beta'] === '1' (set once with `?beta=1`). This
 *     is the link Josh shares with beta feedback testers.
 *   - `off`  — production for ordinary users: no feedback UI at all.
 *
 * A `?dev=1` / `?beta=1` URL switch persists the flag on the device (bookmark
 * `<app-url>?beta=1` to reach beta mode on a phone); `?dev=0` / `?beta=0` clear
 * it. `?beta=1` wins over the ambient dev build so beta mode can be exercised
 * locally during development.
 */
export const DEV_FLAG_KEY = 'genre.dev'
export const BETA_FLAG_KEY = 'genre.beta'

export type FeedbackMode = 'off' | 'dev' | 'beta'

/** Apply `?dev=1|0` / `?beta=1|0` URL switches to the persisted device flags. */
function applyUrlOverride(): void {
  try {
    const q = new URLSearchParams(window.location.search)
    const dev = q.get('dev')
    if (dev === '1') localStorage.setItem(DEV_FLAG_KEY, '1')
    else if (dev === '0') localStorage.removeItem(DEV_FLAG_KEY)
    const beta = q.get('beta')
    if (beta === '1') localStorage.setItem(BETA_FLAG_KEY, '1')
    else if (beta === '0') localStorage.removeItem(BETA_FLAG_KEY)
  } catch {
    /* no window/localStorage — ignore */
  }
}

export function getFeedbackMode(): FeedbackMode {
  applyUrlOverride()
  let dev = false
  let beta = false
  try {
    dev = localStorage.getItem(DEV_FLAG_KEY) === '1'
    beta = localStorage.getItem(BETA_FLAG_KEY) === '1'
  } catch {
    /* ignore */
  }
  // An explicit beta flag wins over the ambient dev build, so beta mode is
  // testable under `vite dev` via `?beta=1`. An explicit dev flag still wins
  // over beta (a developer who set both wants the full tools).
  if (beta && !dev) return 'beta'
  if (dev) return 'dev'
  if (import.meta.env.DEV) return 'dev'
  return 'off'
}

export function isFeedbackEnabled(): boolean {
  return getFeedbackMode() !== 'off'
}

/** True in beta (external-tester) mode: comment-only, no text editing. */
export function isBetaMode(): boolean {
  return getFeedbackMode() === 'beta'
}
