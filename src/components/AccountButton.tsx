/**
 * Header sign-in control. "Sign in with Google" when signed out; the account
 * email with a sign-out menu when signed in. Hidden entirely when no Google
 * client id is configured, so the offline/local-only build is unchanged.
 */
import { useEffect, useState } from 'react'
import {
  ensureScope,
  fetchIdentity,
  forgetToken,
  isGoogleConfigured,
} from '../lib/google/auth'
import {
  clearAccount,
  getAccount,
  getSyncAuthorId,
  saveAccount,
  type Account,
} from '../lib/google/account'
import { syncEngine, useSyncStatus } from '../lib/sync/engine'

export function AccountButton() {
  const [account, setAccount] = useState<Account | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const sync = useSyncStatus()

  useEffect(() => {
    getAccount().then(setAccount)
  }, [])

  if (!isGoogleConfigured()) return null

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      await ensureScope('file')
      const identity = await fetchIdentity()
      await getSyncAuthorId() // create the per-device id on first sign-in
      const next: Account = { email: identity.email, name: identity.name, photo: identity.photo }
      await saveAccount(next)
      setAccount(next)
      void syncEngine.start()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    syncEngine.stop()
    forgetToken()
    await clearAccount()
    setAccount(null)
    setMenuOpen(false)
  }

  const SYNC_DOT: Record<string, string> = {
    idle: 'bg-emerald-500',
    syncing: 'bg-amber-400 animate-pulse',
    offline: 'bg-gray-300',
    error: 'bg-red-500',
  }
  const syncTitle =
    sync.state === 'error'
      ? `Sync error: ${sync.error ?? 'unknown'}`
      : sync.state === 'syncing'
        ? 'Syncing…'
        : sync.state === 'offline'
          ? 'Offline — will sync when back online'
          : sync.lastSyncedAt
            ? `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}`
            : 'Up to date'

  if (!account) {
    return (
      <div className="flex flex-col items-end">
        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
        {error && <span className="mt-1 text-xs text-red-600">{error}</span>}
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        title={account.email}
      >
        {account.photo ? (
          <img src={account.photo} alt="" className="h-6 w-6 rounded-full" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs">
            {(account.name ?? account.email).slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[12rem] truncate sm:inline">{account.email}</span>
        <span
          className={`h-2 w-2 rounded-full ${SYNC_DOT[sync.state] ?? 'bg-gray-300'}`}
          title={syncTitle}
          aria-label={syncTitle}
        />
      </button>
      {menuOpen && (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg">
          <div className="truncate px-3 py-1.5 text-xs text-gray-500">{account.email}</div>
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
