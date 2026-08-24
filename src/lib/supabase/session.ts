/**
 * Thin React binding over Supabase auth. Exposes the current user (id + email)
 * and the four actions the account flow needs: sign in with a password, change
 * a password, ask for a reset email, and sign out. Everything no-ops gracefully
 * when Supabase isn't configured, so builds without it are unaffected.
 *
 * There is deliberately ONE way in: email and password. The magic link that used
 * to sit under the password field is gone. It existed only because the project
 * had no custom SMTP and could not be trusted to deliver a reset email; with
 * Brevo now relaying (100/hour, not two), a real "forgot your password" flow
 * works, and a second half-working door next to it only ever split the
 * instructions we give people.
 */
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './client'
import { forgetAccount } from './accountMemory'

/**
 * Lives here, not in `signup.ts`, because three places enforce it now: creating
 * an account, changing a password, and finishing a reset. The server's own floor
 * is set to match (Supabase auth config, `password_min_length`), so a password
 * this side accepts can never be refused by the API for being short.
 */
export const MIN_PASSWORD_LENGTH = 8

export interface BetaUser {
  id: string
  email: string
  name?: string
}

function toUser(session: Session | null): BetaUser | null {
  const u = session?.user
  if (!u) return null
  const name = (u.user_metadata?.name ?? u.user_metadata?.full_name) as string | undefined
  return { id: u.id, email: u.email ?? '', name }
}

export interface SessionState {
  /** Whether Supabase is configured in this build at all. */
  configured: boolean
  /** False until the initial session lookup resolves (so UI can wait). */
  ready: boolean
  user: BetaUser | null
}

export function useSupabaseSession(): SessionState {
  const configured = isSupabaseConfigured()
  const [user, setUser] = useState<BetaUser | null>(null)
  const [ready, setReady] = useState(!configured)

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(toUser(data.session))
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(toUser(session))
      setReady(true)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return { configured, ready, user }
}

export interface SignInResult {
  ok: boolean
  error?: string
}

/**
 * Sign in with the email + password from the beta invite. This is the primary
 * beta path: accounts are pre-created for testers, so no email is sent and the
 * built-in email rate limit never applies.
 */
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'Sign-in is not available in this build yet.' }
  const clean = email.trim()
  if (!clean || !password) return { ok: false, error: 'Enter your email and password.' }
  const { error } = await supabase.auth.signInWithPassword({ email: clean, password })
  if (!error) return { ok: true }
  // Supabase's stock wording gives a stuck person nothing to do next. Most
  // "invalid credentials" at a workshop are someone who never made an account,
  // so point at the door that fixes that.
  if (/invalid login credentials/i.test(error.message)) {
    return {
      ok: false,
      error:
        'That email and password do not match an account here. New to the app? Create an account with your team code.',
    }
  }
  return { ok: false, error: error.message }
}

/**
 * Set a new password for the currently-signed-in user.
 *
 * Serves two callers that look different and are the same call: "change my
 * password" from the account menu, and the last step of a reset, where following
 * the emailed link has already put a (recovery) session in place. The project has
 * `security_update_password_require_reauthentication` off, so the recovery
 * session is sufficient and the person is not asked for a password they came
 * here because they do not have.
 */
export async function updatePassword(newPassword: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'Not available in this build.' }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Send the "set a new password" email.
 *
 * The link comes back to the app root rather than a dedicated /auth/reset route,
 * for two reasons. The root is already in the project's `uri_allow_list`, so this
 * needs no config change and cannot break by drifting out of sync with it. And
 * the app uses `createBrowserRouter`, which ignores the `#access_token=…&
 * type=recovery` fragment Supabase appends — so the recovery tokens and the
 * router never contend for the URL, and `detectSessionInUrl` picks them up
 * exactly as it already does.
 *
 * Always reports success, even for an address with no account. Saying "no account
 * here" would turn this box into a way to ask the server which of a list of
 * colleagues has signed up.
 */
export async function requestPasswordReset(email: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'Password reset is not available in this build yet.' }
  const clean = email.trim()
  if (!clean) return { ok: false, error: 'Enter your email address.' }
  const redirectTo = window.location.origin + import.meta.env.BASE_URL
  const { error } = await supabase.auth.resetPasswordForEmail(clean, { redirectTo })
  if (!error) return { ok: true }
  // The project sets smtp_max_frequency to 60s per address. Supabase reports that
  // as a 429 alongside the hourly ceiling, and "rate limit exceeded" tells someone
  // who tapped the button twice nothing about what to do next.
  if (error.status === 429 || /rate limit|too many/i.test(error.message)) {
    return {
      ok: false,
      error: 'A reset email has just gone out. Give it a minute, then ask again if it has not arrived.',
    }
  }
  return { ok: false, error: error.message }
}

/**
 * Sign out on purpose.
 *
 * Forgetting the account marker is the load-bearing half. `SIGNED_OUT` fires for
 * a dropped session as well as this, so the marker is the only thing that tells
 * them apart — leave it behind and the next app start greets someone who just
 * chose to sign out with "you've been signed out", which teaches people to
 * dismiss the one warning that matters.
 */
export async function signOutBeta(): Promise<void> {
  forgetAccount()
  await supabase?.auth.signOut()
}
