/**
 * Deep-link join: `/teams/join?code=...`.
 *
 * The code still has to be typed or pasted somewhere, so this exists to save a
 * room of people doing it by hand. A facilitator can put one link in a chat
 * message or on a slide and everyone lands on the shared worksheet.
 *
 * It joins automatically only when signed in. Otherwise it holds the code,
 * offers sign-in, and joins once a session appears, so the link survives being
 * opened by someone who has not signed in yet.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useSupabaseSession } from '../lib/supabase/session'
import { joinAndAdopt } from '../lib/sync/team'
import { syncEngine } from '../lib/sync/engine'
import { openAccountDialog } from '../components/account/dialogStore'
import { isNamedProject } from '../lib/storage/appState'

type State = 'idle' | 'joining' | 'joined' | 'error'

export function JoinTeam() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { reload } = useActiveContext()
  const { configured, user } = useSupabaseSession()

  const code = (params.get('code') ?? '').trim()
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState<string | null>(null)
  // A re-render must not fire a second join for the same code.
  const attempted = useRef(false)

  const run = useCallback(async () => {
    if (!code || attempted.current) return
    attempted.current = true
    setState('joining')
    try {
      const res = await joinAndAdopt(code)
      reload()
      syncEngine.syncNow()
      setState('joined')
      // A team published before names existed still has the placeholder sitting
      // in `shared_projects.name`, and "Opening Untitled project" is the exact
      // sentence that made people doubt they had joined the right thing.
      setMessage(isNamedProject(res.name) ? res.name : 'your team')
      setTimeout(() => navigate('/'), 1200)
    } catch (e) {
      setState('error')
      setMessage(e instanceof Error ? e.message : 'Could not join.')
    }
  }, [code, navigate, reload])

  useEffect(() => {
    if (user && code) void run()
  }, [user, code, run])

  if (!code) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">No code in this link</h1>
        <p className="mt-2 text-sm text-gray-600">
          Ask the facilitator to send it again, or type the code on the team page.
        </p>
        <button
          type="button"
          onClick={() => navigate('/teams')}
          className="mt-4 rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
        >
          Enter a code
        </button>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Sharing is off in this build</h1>
        <p className="mt-2 text-sm text-gray-600">The app still works on this device.</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Sign in to join</h1>
        <p className="mt-2 text-sm text-gray-600">
          You are joining <code className="rounded bg-gray-100 px-1">{code}</code>. Any email
          address works.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => openAccountDialog('signin')}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => openAccountDialog('create')}
            className="rounded border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
          >
            Create an account
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md p-6 text-center">
      {state === 'joining' && (
        <>
          <h1 className="text-lg font-semibold">Joining…</h1>
          <p className="mt-2 text-sm text-gray-600">Bringing the team's work onto this device.</p>
        </>
      )}
      {state === 'joined' && (
        <>
          <h1 className="text-lg font-semibold">You are in</h1>
          <p className="mt-2 text-sm text-gray-600">Opening {message}.</p>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 className="text-lg font-semibold">Could not join</h1>
          <p className="mt-2 text-sm text-red-600">{message}</p>
          <button
            type="button"
            onClick={() => navigate('/teams')}
            className="mt-4 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Try typing the code
          </button>
        </>
      )}
    </div>
  )
}
