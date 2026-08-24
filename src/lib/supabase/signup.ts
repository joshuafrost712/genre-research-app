/**
 * Self-serve account creation against the `signup` Edge Function.
 *
 * The client never calls `supabase.auth.signUp()`: the project has `disable_signup`
 * on, precisely so the public anon key cannot mint accounts. Creation goes through
 * the invite-code-gated function instead (see supabase/functions/signup/index.ts).
 *
 * The endpoint is derived from VITE_SUPABASE_URL rather than carried in its own
 * build variable, because the function always lives on the same project as the auth
 * server. VITE_SIGNUP_URL overrides it for local `supabase functions serve`.
 */
import { supabase } from './client'
import { signInWithPassword, MIN_PASSWORD_LENGTH, type SignInResult } from './session'

// Re-exported so the existing callers keep their import path; the constant itself
// now lives with the other auth rules in session.ts.
export { MIN_PASSWORD_LENGTH }

function endpoint(): string | null {
  const override = import.meta.env.VITE_SIGNUP_URL as string | undefined
  if (override) return override
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  return url ? `${url.replace(/\/$/, '')}/functions/v1/signup` : null
}

export interface NewAccount {
  name: string
  email: string
  password: string
  confirm: string
  code: string
}

/**
 * Note on where invite-code tolerance lives: entirely on the server.
 *
 * A client-side shape rule was tried here and removed. It would have become a
 * lockout the day `enable-signup.sh` changes format — someone holding a valid
 * code, refused by a stale regex, with no way to tell anyone — and it duplicated
 * a normalisation that then had two places to drift apart in. The Edge Function
 * normalises what it receives and its rejection now names the format, so the
 * person gets the same specific advice from the one component that actually
 * knows the answer. The static hint under the input field does the proactive
 * half; see AccountDialog.
 */

/**
 * Validate locally, create the account, then sign in with the credentials just
 * used, so a new person lands signed in rather than facing a second form.
 *
 * Returns the same {ok, error} shape as the other auth actions so callers can treat
 * every path identically.
 */
export async function createAccount(input: NewAccount): Promise<SignInResult> {
  const url = endpoint()
  if (!url || !supabase) {
    return { ok: false, error: 'Account creation is not available in this build yet.' }
  }

  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const code = input.code.trim()

  // Checked here as well as server-side: a mismatch should never cost a round trip,
  // and the server cannot tell us which of the two fields the person mistyped.
  if (!name) return { ok: false, error: 'Enter your name.' }
  if (!email) return { ok: false, error: 'Enter your email address.' }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (input.password !== input.confirm) {
    return { ok: false, error: 'The two passwords do not match.' }
  }
  if (!code) return { ok: false, error: 'Enter your team code (or the invite code from your email).' }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password: input.password, code }),
    })
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
  }

  if (!res.ok) {
    const message = await errorMessage(res)
    return { ok: false, error: message }
  }

  // Created. Sign in with the very credentials they chose.
  return await signInWithPassword(email, input.password)
}

/** Prefer the function's own wording; fall back to something a person can act on. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return body.error
  } catch {
    // Non-JSON body (a gateway error page, say). Fall through.
  }
  if (res.status === 429) return 'Too many attempts. Wait a few minutes and try again.'
  return 'Could not create the account. Try again shortly.'
}
