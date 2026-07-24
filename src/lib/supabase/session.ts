/**
 * Thin React binding over Supabase auth for beta mode. Exposes the current beta
 * user (id + email) and the two actions the welcome flow needs: send a magic
 * link, and sign out. Everything no-ops gracefully when Supabase isn't
 * configured, so non-beta builds are unaffected.
 */
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './client'

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
 * Send a magic-link / one-time-code email. Secondary fallback (the built-in
 * email service is rate-limited to a couple per hour). The link returns the
 * tester to this app origin, where `detectSessionInUrl` completes the sign-in.
 */
export async function signInWithEmail(email: string): Promise<SignInResult> {
  if (!supabase) return { ok: false, error: 'Sign-in is not available in this build yet.' }
  const clean = email.trim()
  if (!clean) return { ok: false, error: 'Enter your email address.' }
  const emailRedirectTo = window.location.origin + import.meta.env.BASE_URL
  const { error } = await supabase.auth.signInWithOtp({ email: clean, options: { emailRedirectTo } })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function signOutBeta(): Promise<void> {
  await supabase?.auth.signOut()
}
