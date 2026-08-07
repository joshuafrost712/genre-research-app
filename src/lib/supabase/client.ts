/**
 * Supabase client: identity (email + password) and, since team sync landed, the
 * Postgres the worksheets replicate through. Work is still written to IndexedDB
 * first and syncs from there, so the app is fully usable with this client null.
 *
 * The anon key is designed to be public (it only permits what row-level security
 * allows), so shipping it in this public build is expected and safe. No
 * service-role key ever touches the client.
 *
 * When the env vars are unset the client is null and every caller degrades
 * gracefully: the whole app still works, it just can't offer sign-in.
 */
// FIRST, and load-bearing. `detectSessionInUrl` below strips the recovery tokens
// out of the URL fragment while creating the client, so anything that wants to
// read that fragment has to have already run. See recovery.ts.
import './recovery'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey)
}

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // Persist the session so a person stays signed in across reloads, and
          // pick up the recovery token when a password-reset link returns here.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null
