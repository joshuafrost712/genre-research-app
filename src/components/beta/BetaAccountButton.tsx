/**
 * Header control for beta mode: shows the signed-in tester's email with a
 * sign-out menu, or a "Sign in" button that re-opens the welcome (which hosts
 * the email magic-link form). Renders nothing outside beta mode or when
 * Supabase isn't configured, so ordinary and dev builds are unchanged.
 */
import { useState } from 'react'
import { isBetaMode } from '../../devfeedback/enabled'
import { useSupabaseSession, signOutBeta, updatePassword } from '../../lib/supabase/session'
import { setMetaValue } from '../../lib/storage/appState'

export function BetaAccountButton() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<string | null>(null)
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

  const savePassword = async () => {
    setPwMsg(null)
    const res = await updatePassword(newPw)
    if (res.ok) {
      setPwMsg('Password updated.')
      setNewPw('')
      setChanging(false)
    } else {
      setPwMsg(res.error ?? 'Could not update password.')
    }
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
        <div className="absolute right-0 z-30 mt-1 w-60 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg">
          <div className="truncate px-3 py-1.5 text-xs text-gray-500">{user.email}</div>
          {changing ? (
            <div className="px-3 py-2">
              <input
                type="password"
                autoFocus
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPw.length >= 8) void savePassword()
                }}
                placeholder="New password (8+ chars)"
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={savePassword}
                  disabled={newPw.length < 8}
                  className="rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChanging(false)
                    setNewPw('')
                    setPwMsg(null)
                  }}
                  className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setChanging(true)}
              className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
            >
              Change password
            </button>
          )}
          {pwMsg && <div className="px-3 py-1 text-xs text-gray-500">{pwMsg}</div>}
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
