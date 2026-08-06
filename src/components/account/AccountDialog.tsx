/**
 * The one place a person signs in or creates an account. Mounted once in the
 * layout and opened from anywhere via `openAccountDialog`.
 *
 * It says plainly that any email works and that Google is not required, because
 * for most of this app's users it isn't: the header used to show only a Google
 * button, which read as "Google account required" and kept people out. Google is
 * a Drive connection, offered separately in the account menu.
 */
import { useEffect, useState } from 'react'
import {
  closeAccountDialog,
  openAccountDialog,
  useAccountDialog,
  type AccountDialogMode,
} from './dialogStore'
import { useSupabaseSession, signInWithEmail, signInWithPassword } from '../../lib/supabase/session'
import { createAccount, MIN_PASSWORD_LENGTH } from '../../lib/supabase/signup'

const FIELD = 'w-full rounded border border-gray-300 px-3 py-2 text-sm'

export function AccountDialog() {
  const mode = useAccountDialog()
  const { configured, user } = useSupabaseSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Signing in succeeds asynchronously through the session listener, so close on
  // the session appearing rather than on the call returning.
  useEffect(() => {
    if (user && mode) closeAccountDialog()
  }, [user, mode])

  if (!mode) return null

  const creating = mode === 'create'

  const reset = () => {
    setError(null)
    setSent(false)
    setBusy(false)
  }

  const switchTo = (next: AccountDialogMode) => {
    reset()
    openAccountDialog(next)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = creating
      ? await createAccount({ name, email, password, confirm, code })
      : await signInWithPassword(email, password)
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Something went wrong. Try again.')
  }

  const sendLink = async () => {
    setBusy(true)
    setError(null)
    const res = await signInWithEmail(email)
    setBusy(false)
    if (res.ok) setSent(true)
    else setError(res.error ?? 'Could not send the link. Please try again.')
  }

  const canSubmit = creating
    ? Boolean(name.trim() && email.trim() && password && confirm && code.trim())
    : Boolean(email.trim() && password)

  return (
    <div
      className="fixed inset-0 z-[2147483002] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={creating ? 'Create an account' : 'Sign in'}
      onClick={closeAccountDialog}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900">
          {creating ? 'Create an account' : 'Sign in'}
        </h2>

        {!configured ? (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Accounts aren't switched on in this build. You can still use the whole app and export
            your work; nothing here is required.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">
              {creating
                ? 'Use any email address, including your work address. You do not need a Google account.'
                : 'Sign in with the email and password you chose.'}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {creating && (
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className={FIELD}
                />
              )}
              <input
                type="email"
                autoFocus={!creating}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={FIELD}
              />
              <input
                type="password"
                autoComplete={creating ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit && !busy) void submit()
                }}
                placeholder={creating ? `Password (${MIN_PASSWORD_LENGTH}+ characters)` : 'Password'}
                className={FIELD}
              />
              {creating && (
                <>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    className={FIELD}
                  />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSubmit && !busy) void submit()
                    }}
                    placeholder="Invite code"
                    className={FIELD}
                  />
                  <p className="text-xs text-gray-500">
                    The invite code came in the email that pointed you here.
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit || busy}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {busy
                  ? creating
                    ? 'Creating…'
                    : 'Signing in…'
                  : creating
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </div>

            {!creating && (
              <div className="mt-3 text-xs text-gray-500">
                {sent ? (
                  <span className="text-emerald-700">
                    Sent a one-time sign-in link to <strong>{email}</strong>. Check your email.
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={sendLink}
                    disabled={!email.trim() || busy}
                    className="underline hover:text-gray-700 disabled:opacity-50"
                  >
                    No password handy? Email me a one-time sign-in link
                  </button>
                )}
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <p className="mt-4 text-sm text-gray-600">
              {creating ? (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchTo('signin')}
                    className="font-medium text-sky-700 underline"
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New here?{' '}
                  <button
                    type="button"
                    onClick={() => switchTo('create')}
                    className="font-medium text-sky-700 underline"
                  >
                    Create an account
                  </button>
                </>
              )}
            </p>
          </>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={closeAccountDialog}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
