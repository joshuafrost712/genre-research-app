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
import { OneCodeJoin } from '../components/team/OneCodeJoin'
import { ImportWork } from '../components/team/ImportWork'
import { listImportSources } from '../lib/team/importWork'
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
  const [joinedId, setJoinedId] = useState<string | null>(null)
  const [canImport, setCanImport] = useState(false)
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
      // A team published before names existed still has the placeholder sitting
      // in `shared_projects.name`, and "Opening Untitled project" is the exact
      // sentence that made people doubt they had joined the right thing.
      setMessage(isNamedProject(res.name) ? res.name : 'your team')
      setJoinedId(res.projectId)
      // The one moment "bring my earlier work in" is most wanted: they just
      // arrived and their days of solo answers are a worksheet away. Only when
      // there is actually something to bring — otherwise straight to work.
      const sources = await listImportSources(res.projectId)
      setCanImport(sources.length > 0)
      setState('joined')
      if (sources.length === 0) setTimeout(() => navigate('/'), 1200)
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
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-center text-lg font-semibold">
          Joining <code className="rounded bg-gray-100 px-1">{code}</code>
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          This code also creates your account — pick an email and password and you are in.
        </p>
        <div className="mt-4">
          {/* onCreated is a deliberate no-op: once the account signs in, `user`
              appears and this page's own effect runs the one join. A second
              joiner here would race it. */}
          <OneCodeJoin code={code} onCreated={() => {}} />
        </div>
        <p className="mt-4 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => openAccountDialog('signin')}
            className="font-medium text-sky-700 underline"
          >
            Sign in
          </button>
        </p>
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
      {state === 'joined' && !canImport && (
        <>
          <h1 className="text-lg font-semibold">You are in</h1>
          <p className="mt-2 text-sm text-gray-600">Opening {message}.</p>
        </>
      )}
      {state === 'joined' && canImport && joinedId && (
        <div className="text-left">
          <h1 className="text-center text-lg font-semibold">You are in {message}</h1>
          <div className="mt-4">
            <ImportWork targetId={joinedId} teamName={message ?? 'this team'} />
          </div>
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              Go to the worksheet
            </button>
          </div>
        </div>
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
