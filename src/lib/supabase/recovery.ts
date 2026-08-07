/**
 * Noticing that someone arrived here from a "set a new password" email.
 *
 * There are two ways to find out, and the app needs both, because either one
 * alone fails silently in the way that matters most.
 *
 * The documented way is the `PASSWORD_RECOVERY` auth event. But recovery tokens
 * arrive in the URL fragment, and `detectSessionInUrl` consumes that fragment as
 * part of creating the client — which happens at module load, well before React
 * has mounted and any component has subscribed to auth events. A listener that
 * registers late simply never hears it. The failure is invisible: the recovery
 * link DID sign them in, so they land on a perfectly normal dashboard with no
 * password prompt and no error, having no way to tell that the thing they asked
 * for did not happen. They ask for another email, and it happens again.
 *
 * So this module reads the fragment itself, synchronously, at module load, and
 * records the answer as a one-shot flag. `client.ts` imports it on its first line
 * expressly to guarantee this runs before `createClient` — that import is
 * load-bearing and is not an unused one. This file must therefore never import
 * `client.ts` back.
 *
 * The event listener stays too, in AccountDialog: whichever of the two fires
 * first opens the dialog, and the flag being one-shot keeps the second from
 * reopening it later over the person's work.
 */

let pending = false

function capture(): void {
  try {
    const hash = window.location.hash
    if (!hash.includes('type=recovery')) return
    // Supabase sends `#access_token=…&type=recovery&…`. Parse rather than
    // substring-match so `type=recovery_something_else` can never trip this.
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    if (params.get('type') === 'recovery') pending = true
  } catch {
    /* no window (tests, SSR): nothing to capture */
  }
}

capture()

/**
 * True exactly once, if this page load began with a recovery link. Consuming it
 * clears it, so a later re-render or a duplicate auth event cannot reopen the
 * dialog after the person has moved on.
 */
export function consumePendingRecovery(): boolean {
  if (!pending) return false
  pending = false
  return true
}
