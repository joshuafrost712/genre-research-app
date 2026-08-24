/**
 * The one place a person signs in, creates an account, or recovers one.
 *
 * Mounted once in the layout and opened from anywhere via `openAccountDialog`.
 * It says plainly that any email works and that Google is not required, because
 * for most of this app's users it isn't: the header used to show only a Google
 * button, which read as "Google account required" and kept people out. Google is
 * a Drive connection, offered separately in the account menu.
 *
 * Four modes, one door. There is no magic link any more: a single "email and
 * password, and here is how to get a new password" story is easier to put in an
 * invite email than two half-working ones, and the reason the link existed (a
 * mailer that could not be trusted to deliver) is gone.
 */
import { useEffect, useState } from 'react'
import {
  closeAccountDialog,
  openAccountDialog,
  useAccountDialog,
  type AccountDialogMode,
} from './dialogStore'
import {
  useSupabaseSession,
  signInWithPassword,
  requestPasswordReset,
  updatePassword,
  MIN_PASSWORD_LENGTH,
} from '../../lib/supabase/session'
import { supabase } from '../../lib/supabase/client'
import { consumePendingRecovery } from '../../lib/supabase/recovery'
import { createAccount } from '../../lib/supabase/signup'

const FIELD = 'w-full rounded border border-gray-300 px-3 py-2 text-sm'

const TITLES: Record<AccountDialogMode, string> = {
  signin: 'Sign in',
  create: 'Create an account',
  forgot: 'Reset your password',
  recover: 'Choose a new password',
}

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
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Signing in succeeds asynchronously through the session listener, so close on
  // the session appearing rather than on the call returning.
  //
  // `recover` is exempt, and that exemption is the whole feature: following a
  // reset link creates a session, so without this the dialog would close in the
  // same tick it opened and nobody would ever be shown the password field.
  useEffect(() => {
    if (user && mode && mode !== 'recover') closeAccountDialog()
  }, [user, mode])

  // Two independent ways to learn that this page load came from a reset email —
  // see recovery.ts for why one is not enough. Whichever arrives first opens the
  // dialog; the flag is one-shot and the mode is idempotent, so the other is a
  // no-op rather than a second dialog.
  useEffect(() => {
    if (consumePendingRecovery()) openAccountDialog('recover')
    if (!supabase) return
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') openAccountDialog('recover')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!mode) return null

  const creating = mode === 'create'
  const forgot = mode === 'forgot'
  const recovering = mode === 'recover'

  const reset = () => {
    setError(null)
    setSent(false)
    setDone(false)
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
      : forgot
        ? await requestPasswordReset(email)
        : recovering
          ? password !== confirm
            ? { ok: false, error: 'The two passwords do not match.' }
            : await updatePassword(password)
          : await signInWithPassword(email, password)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Something went wrong. Try again.')
      return
    }
    if (forgot) setSent(true)
    if (recovering) setDone(true)
  }

  const canSubmit = creating
    ? Boolean(name.trim() && email.trim() && password && confirm && code.trim())
    : forgot
      ? Boolean(email.trim())
      : recovering
        ? Boolean(password && confirm)
        : Boolean(email.trim() && password)

  const submitLabel = busy
    ? creating
      ? 'Creating…'
      : forgot
        ? 'Sending…'
        : recovering
          ? 'Saving…'
          : 'Signing in…'
    : creating
      ? 'Create account'
      : forgot
        ? 'Send the reset link'
        : recovering
          ? 'Save new password'
          : 'Sign in'

  const blurb = creating
    ? 'Use any email address, including your work address. You do not need a Google account.'
    : forgot
      ? 'Enter the email address on your account and we will send you a link to set a new password.'
      : recovering
        ? 'Pick a new password for your account. You are signed in already, so this is the last step.'
        : 'Sign in with the email and password you chose.'

  return (
    <div
      className="fixed inset-0 z-[2147483002] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={TITLES[mode]}
      onClick={closeAccountDialog}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900">{TITLES[mode]}</h2>

        {!configured ? (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Accounts aren't switched on in this build. You can still use the whole app and export
            your work; nothing here is required.
          </p>
        ) : sent ? (
          <>
            <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              If there is an account for <strong>{email}</strong>, a link to set a new password is
              on its way. It arrives from "Josh Frost OBT-CDT" and is good for one hour. Check your
              spam folder if you don't see it.
            </p>
            <p className="mt-4 text-sm text-gray-600">
              <button
                type="button"
                onClick={() => switchTo('signin')}
                className="font-medium text-sky-700 underline"
              >
                Back to sign in
              </button>
            </p>
          </>
        ) : done ? (
          <>
            <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              Your new password is saved and you are signed in. Use it next time you sign in on any
              device.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closeAccountDialog}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Get to work
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-gray-600">{blurb}</p>

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
              {!recovering && (
                <input
                  type="email"
                  autoFocus={!creating}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit && !busy) void submit()
                  }}
                  placeholder="you@example.com"
                  className={FIELD}
                />
              )}
              {!forgot && (
                <input
                  type="password"
                  autoFocus={recovering}
                  autoComplete={creating || recovering ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit && !busy) void submit()
                  }}
                  placeholder={
                    creating || recovering
                      ? `Password (${MIN_PASSWORD_LENGTH}+ characters)`
                      : 'Password'
                  }
                  className={FIELD}
                />
              )}
              {(creating || recovering) && (
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit && !busy) void submit()
                  }}
                  placeholder="Repeat your password"
                  className={FIELD}
                />
              )}
              {creating && (
                <>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSubmit && !busy) void submit()
                    }}
                    placeholder="Team code or invite code"
                    className={FIELD}
                  />
                  <p className="text-xs text-gray-500">
                    Your team's join code works here (three words and a number). So does the invite
                    code from your email.
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit || busy}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {submitLabel}
              </button>
            </div>

            {mode === 'signin' && (
              <div className="mt-3 text-xs text-gray-500">
                <button
                  type="button"
                  onClick={() => switchTo('forgot')}
                  className="underline hover:text-gray-700"
                >
                  Forgot your password?
                </button>
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
              ) : forgot ? (
                <>
                  Remembered it?{' '}
                  <button
                    type="button"
                    onClick={() => switchTo('signin')}
                    className="font-medium text-sky-700 underline"
                  >
                    Back to sign in
                  </button>
                </>
              ) : recovering ? null : (
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
