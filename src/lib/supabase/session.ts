/**
 * Thin React binding over Supabase auth for beta mode. Exposes the current beta
 * user (id + email) and the two actions the welcome flow needs: send a magic
 * link, and sign out. Everything no-ops gracefully when Supabase isn't
 * configured, so non-beta builds are unaffected.
 */
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './client'
import { forgetAccount } from './accountMemory'

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
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Change the signed-in user's password (from the account menu). */
export async function updatePassword(newPassword: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'Not available in this build.' }
  if (newPassword.length < 8) return { ok: false, error: 'Use at least 8 characters.' }
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/**
 * Send a magic-link / one-time-code email. Strictly a fallback: the project has no
 * custom SMTP, so this runs on Supabase's built-in mailer at TWO EMAILS PER HOUR
 * project-wide. The third person to try it in any hour gets nothing, which used to
 * look like a silent failure, so that ceiling is now named in the error rather than
 * passed through as Supabase's wording. The real fix is custom SMTP.
 *
 * The link returns the tester to this app origin, where `detectSessionInUrl`
 * completes the sign-in.
 */
export async function signInWithEmail(email: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'Sign-in is not available in this build yet.' }
  const clean = email.trim()
  if (!clean) return { ok: false, error: 'Enter your email address.' }
  const emailRedirectTo = window.location.origin + import.meta.env.BASE_URL
  const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { emailRedirectTo } })
  if (!error) return { ok: true }
  if (error.status === 429 || /rate limit/i.test(error.message)) {
    return {
      ok: false,
      error:
        'Sign-in emails are limited to a couple per hour across everyone using the app, and that limit is currently reached. Use your password, or try again in an hour.',
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
