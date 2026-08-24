/**
 * One code does everything: the team join code creates the account too.
 *
 * Before this, a participant needed the app-wide invite code to exist and their
 * team's join code to belong — two codes from two channels, and the one on the
 * whiteboard was the join code. The signup Edge Function now honours a join code
 * (see supabase/functions/signup/index.ts), so this form asks for the code plus
 * email and password, creates the account signed in, and then hands off to the
 * one place in the app that joins: /teams/join.
 *
 * Deliberately NOT a joiner itself. JoinTeam already owns the join-once ordering
 * (join → pull to completion → switch), and a second joiner racing it is exactly
 * the class of bug its header warns about. Hosts that already sit on that page
 * pass `onCreated` to suppress the navigation and let their own effect join.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createAccount } from '../../lib/supabase/signup'
import { MIN_PASSWORD_LENGTH } from '../../lib/supabase/session'
import { openAccountDialog } from '../account/dialogStore'

const FIELD = 'w-full rounded border border-gray-300 px-3 py-2 text-sm'

export function OneCodeJoin({
  code: fixedCode,
  onCreated,
}: {
  /** Pre-filled from a join link; the field is still editable for typos. */
  code?: string
  /** Override the default navigation to /teams/join once the account exists. */
  onCreated?: (code: string) => void
}) {
  const navigate = useNavigate()
  const [code, setCode] = useState(fixedCode ?? '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    Boolean(code.trim() && name.trim() && email.trim() && password && confirm) && !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await createAccount({ name, email, password, confirm, code })
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Something went wrong. Try again.')
      return
    }
    // Signed in. Joining happens on the join page, the one component that owns
    // the join → pull → switch ordering.
    if (onCreated) onCreated(code.trim())
    else navigate(`/teams/join?code=${encodeURIComponent(code.trim())}`)
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) void submit()
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={onEnter}
        placeholder="Team code (three words and a number)"
        className={FIELD}
        autoFocus={!fixedCode}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter}
        placeholder="Your name"
        className={FIELD}
        autoFocus={Boolean(fixedCode)}
      />
      <input
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={onEnter}
        placeholder="you@example.com — any email works"
        className={FIELD}
      />
      <input
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={onEnter}
        placeholder={`Choose a password (${MIN_PASSWORD_LENGTH}+ characters)`}
        className={FIELD}
      />
      <input
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onKeyDown={onEnter}
        placeholder="Repeat your password"
        className={FIELD}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {busy ? 'Setting you up…' : 'Create my account & join'}
      </button>
      {error && (
        <div className="text-sm text-red-600">
          <p>{error}</p>
          {/* The likeliest "error" on this form is a returning participant: the
              account exists, so the fix is the sign-in door, not retyping. */}
          {/already an account/i.test(error) && (
            <button
              type="button"
              onClick={() => openAccountDialog('signin')}
              className="mt-1 font-medium text-sky-700 underline"
            >
              Sign in instead
            </button>
          )}
        </div>
      )}
      <p className="text-xs text-gray-500">
        This is not Google. Your account is just this email and password, and it is what your
        team's work syncs through.
      </p>
    </div>
  )
}
