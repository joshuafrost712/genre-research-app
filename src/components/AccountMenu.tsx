/**
 * The header account control, shown in every mode. It carries two independent,
 * coexisting identities:
 *
 *   - the **account** (Supabase email/password) — the primary identity, usable with
 *     any email address, which tags feedback and authorizes live translation; and
 *   - an optional **Google** connection, which does exactly one thing: save a copy
 *     of the work to that person's Google Drive.
 *
 * It used to render only in beta mode, with ordinary builds falling back to a
 * Google-only button. That was the whole reason the app looked like it required a
 * Google account, so both identities are now offered everywhere and the Google entry
 * says what it is actually for.
 */
import { useEffect, useState } from 'react'
import { isGoogleConfigured, forgetToken } from '../lib/google/auth'
import { clearAccount, getAccount, type Account } from '../lib/google/account'
import { signInWithGoogle } from '../lib/google/signIn'
import { useSyncStatus } from '../lib/sync/engine'
import { useSupabaseSession, signOutBeta, updatePassword } from '../lib/supabase/session'
import { setFeedbackAuthor } from '../lib/feedback/identity'
import { openAccountDialog } from './account/dialogStore'
import { ProjectPicker } from './ProjectPicker'
import { storageDurability, type Durability } from '../lib/storage/persist'
import { clearLocalData } from '../lib/storage/reset'
import { useLocale } from '../lib/i18n/LocaleContext'

const SYNC_DOT: Record<string, string> = {
  idle: 'bg-emerald-500',
  syncing: 'bg-amber-400 animate-pulse',
  offline: 'bg-gray-300',
  error: 'bg-red-500',
}

type OpenMenu = null | 'account' | 'google'

export function AccountMenu() {
  const { configured, user } = useSupabaseSession()
  const { t } = useLocale()
  const [googleAccount, setGoogleAccount] = useState<Account | null>(null)
  const [durability, setDurability] = useState<Durability>('unknown')
  const sync = useSyncStatus()

  const [menu, setMenu] = useState<OpenMenu>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<string | null>(null)

  useEffect(() => {
    getAccount().then(setGoogleAccount)
  }, [])

  // Re-read whenever the menu opens: a browser can grant persistence later, once
  // it has decided the app is used rather than visited, so a value read once at
  // startup would go stale as "not guaranteed" and stay there.
  useEffect(() => {
    if (menu === 'account') void storageDurability().then(setDurability)
  }, [menu])

  const googleAvailable = isGoogleConfigured()

  // Nothing to offer and nothing to show: stay out of the header entirely.
  if (!configured && !googleAvailable && !googleAccount) return null

  const connectGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      const acc = await signInWithGoogle()
      setGoogleAccount(acc)
      // Account identity wins for tagging; only fill from Google when no account.
      if (!user) setFeedbackAuthor({ email: acc.email, name: acc.name })
      setMenu(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  const disconnectGoogle = async () => {
    // Deliberately does NOT stop the sync engine. It used to, from the era when
    // the engine looked Google-owned — but the engine runs on the Supabase
    // session (see engine.ts) and has nothing to do with Drive. Stopping it here
    // meant a signed-in person tapping Disconnect silently froze their TEAM sync
    // for the rest of the session while the chip kept saying "Saved".
    forgetToken()
    await clearAccount()
    setGoogleAccount(null)
    if (!user) setFeedbackAuthor(null)
    setMenu(null)
  }

  const accountSignOut = async () => {
    await signOutBeta()
    setMenu(null)
  }

  /**
   * Wipe the browser and sign out. Confirms first and says plainly what survives:
   * synced work is in the account and comes back on the next sign-in, unsynced
   * work does not come back at all. Sync status is on screen right above this, so
   * someone with a pending count can see the risk before they answer.
   */
  const clearDevice = async () => {
    const pending = sync.pending
    const warning = pending
      ? `\n\nWARNING: ${pending} change${pending === 1 ? '' : 's'} have not synced yet and will be lost.`
      : ''
    const ok = window.confirm(
      'This removes every worksheet, passage and recording from this browser.\n\n' +
        'Anything already synced is safe in your account and returns when you sign in.' +
        warning +
        '\n\nClear this device?',
    )
    if (!ok) return
    setMenu(null)
    await signOutBeta()
    await clearLocalData()
  }

  const open = (mode: 'signin' | 'create') => {
    openAccountDialog(mode)
    setMenu(null)
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

  const toggle = (m: OpenMenu) => setMenu((cur) => (cur === m ? null : m))

  return (
    <div className="flex items-center gap-2">
      {/* Signed out: ONE button, straight to the account dialog, and it never
          disappears. It used to render only when no Google connection existed,
          which is how the Psalms workshop got stuck: connect Drive (the familiar
          button), your Gmail address appears up top, the Sign in button vanishes,
          and the Team page still says "sign in first" with no visible way to do
          it. Google is deliberately absent here — connecting Drive is offered
          inside the signed-in account menu, where it cannot be mistaken for
          logging in. */}
      {!user && configured && (
        <button
          type="button"
          onClick={() => open('signin')}
          className="shrink-0 rounded border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
        >
          Sign in
        </button>
      )}
      {/* A build with no account system at all (configured=false) keeps the old
          direct Drive offer, since the signed-in menu that normally carries it
          can never appear. */}
      {!user && !configured && googleAvailable && !googleAccount && (
        <button
          type="button"
          onClick={connectGoogle}
          disabled={busy}
          className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'Connecting…' : 'Save to Google Drive'}
        </button>
      )}
      {!user && error && <span className="text-xs text-red-600">{error}</span>}

      {/* Account identity (primary). */}
      {user && (
        <div className="relative">
          <button
            type="button"
            onClick={() => toggle('account')}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            title={user.email}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs text-sky-800">
              {(user.name ?? user.email).slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden max-w-[12rem] truncate sm:inline">{user.email}</span>
          </button>
          {menu === 'account' && (
            <div className="absolute right-0 z-30 mt-1 w-72 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg">
              <div className="truncate px-3 py-1.5 text-xs text-gray-500">{user.email}</div>
              {/*
                Whether the browser agreed to keep this app's data. Shown because
                a field problem ("everything vanished on my phone") is otherwise
                unanswerable, and because a "not guaranteed" here is the cue that
                the work needs to be in the account rather than only on the device.
              */}
              {durability !== 'unknown' && (
                <div className="px-3 pb-1.5 text-xs text-gray-400">
                  {t('account.storageLabel')}:{' '}
                  {durability === 'protected'
                    ? t('account.storageProtected')
                    : t('account.storageBestEffort')}
                </div>
              )}
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
              <ProjectPicker onDone={() => setMenu(null)} />
              {googleAvailable && !googleAccount && (
                <button
                  type="button"
                  onClick={connectGoogle}
                  disabled={busy}
                  className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  {busy ? 'Connecting…' : 'Save to Google Drive (optional)'}
                </button>
              )}
              <button
                type="button"
                onClick={accountSignOut}
                className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
              >
                Sign out
              </button>
              {/* The deliberate answer to "I am handing this laptop to someone
                  else." Signing out keeps local work on purpose, so without this
                  there is no way to leave a clean device except waiting for the
                  next person's sign-in to wipe it for them. */}
              <button
                type="button"
                onClick={clearDevice}
                className="block w-full px-3 py-1.5 text-left text-gray-500 hover:bg-gray-100"
              >
                Clear this device…
              </button>
              {error && <div className="px-3 py-1 text-xs text-red-600">{error}</div>}
            </div>
          )}
        </div>
      )}

      {/* Google connection (optional Drive storage). */}
      {googleAccount && (
        <div className="relative">
          <button
            type="button"
            onClick={() => toggle('google')}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
            title={`Google Drive backup: ${googleAccount.email}`}
          >
            {googleAccount.photo ? (
              <img src={googleAccount.photo} alt="" className="h-6 w-6 rounded-full" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs">
                {(googleAccount.name ?? googleAccount.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            {/* Labelled "Drive", NEVER the email address. Showing the Gmail
                address here made a connected-but-signed-out person read as
                logged in, which is the screenshot that opened this bug. */}
            {!user && <span className="hidden text-xs text-gray-500 sm:inline">Drive</span>}
            <span
              className={`h-2 w-2 rounded-full ${SYNC_DOT[sync.state] ?? 'bg-gray-300'}`}
              title={syncTitle}
              aria-label={syncTitle}
            />
          </button>
          {menu === 'google' && (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg">
              <div className="px-3 py-1.5 text-xs text-gray-500">
                Google Drive
                <span className="block truncate text-gray-700">{googleAccount.email}</span>
              </div>
              {!user && configured && (
                <button
                  type="button"
                  onClick={() => open('signin')}
                  className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
                >
                  Sign in with your account
                </button>
              )}
              <button
                type="button"
                onClick={disconnectGoogle}
                className="block w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
              >
                Disconnect
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
