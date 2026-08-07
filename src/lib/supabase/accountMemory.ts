/**
 * Remember that this device has had an account signed in.
 *
 * This exists because of a failure an auth listener structurally cannot catch.
 * Supabase fires `SIGNED_OUT` when a session is lost while the app is running,
 * and the sync engine already handles that. But on 2026-08-07 Chrome simply
 * STARTED signed out after a sleep/wake, having dropped the stored session while
 * the app was closed. No event fires for that, because nothing was listening
 * when it happened. From the app's point of view at boot, a person whose session
 * was silently dropped and a first-time visitor look exactly alike.
 *
 * One marker of our own separates them. "No session AND we remember an account
 * here" means the session went missing and the person should be told. "No session
 * and no marker" is an ordinary guest, who must never be nagged to sign in to an
 * account they have never had.
 *
 * Deliberately stored under our own key rather than read out of Supabase's
 * storage: the whole point is to survive the disappearance of Supabase's entry.
 * (If the browser evicts the entire origin bucket, the marker goes too — but then
 * there is no local work left to warn about either, and the person is a
 * first-time visitor for every practical purpose.)
 */

const KEY = 'genre.lastAccountEmail'

/** Called on a successful sign-in. */
export function rememberAccount(email: string): void {
  try {
    localStorage.setItem(KEY, email)
  } catch {
    // Private mode with storage disabled: the warning is a nicety, not a feature
    // worth throwing over.
  }
}

/** The account this device last signed in as, if any. */
export function rememberedAccount(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/**
 * Called on a DELIBERATE sign-out only. Forgetting here is what keeps the
 * "you've been signed out" notice honest: someone who chose to sign out is not
 * surprised and must not be told they were.
 */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
