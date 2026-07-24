/**
 * Supabase client, used ONLY for beta-tester authentication (email magic link),
 * so feedback can be tagged to the person who left it. Project data still lives
 * locally in IndexedDB and feedback still ships through the existing Apps Script
 * sink — Supabase is the identity layer, not a data store.
 *
 * The anon key is designed to be public (it only permits what row-level security
 * allows), so shipping it in this public build is expected and safe. No
 * service-role key ever touches the client.
 *
 * When the env vars are unset the client is null and every caller degrades
 * gracefully: beta mode still works, it just can't offer sign-in.
 */
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
          // Persist the session so a tester stays signed in across reloads, and
          // pick up the magic-link token when Supabase redirects back to the app.
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null
