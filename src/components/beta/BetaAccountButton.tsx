/**
 * Header control for beta mode: shows the signed-in tester's email with a
 * sign-out menu, or a "Sign in" button that re-opens the welcome (which hosts
 * the email magic-link form). Renders nothing outside beta mode or when
 * Supabase isn't configured, so ordinary and dev builds are unchanged.
 */
import { useState } from 'react'
import { isBetaMode } from '../../devfeedback/enabled'
import { useSupabaseSession, signOutBeta } from '../../lib/supabase/session'
import { setMetaValue } from '../../lib/storage/appState'

export function BetaAccountButton() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { configured, user } = useSupabaseSession()

  if (!isBetaMode() || !configured) return null

  if (!user) {
    return (
      <button
        type="button"
        // Re-open the welcome overlay, which carries the sign-in form.
        onClick={() => void setMetaValue('betaWelcomeSeen', '0')}
        className="rounded border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
      >
        Sign in
      </button>
    )
  }

  const signOut = async () => {
    await signOutBeta()
    setMenuOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        title={user.email}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs text-sky-800">
          {(user.name ?? user.email).slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-[12rem] truncate sm:inline">{user.email}</span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg">
          <div className="truncate px-3 py-1.5 text-xs text-gray-500">{user.email}</div>
          <button
            type="button"
            onClick={signOut}
            className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
