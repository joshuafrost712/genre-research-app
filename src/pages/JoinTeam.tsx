import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useActiveContext } from '../components/ActiveContextProvider'
import { isGoogleConfigured } from '../lib/google/auth'
import { getAccount } from '../lib/google/account'
import { setActiveScopeProject } from '../lib/sync/scope'
import { joinByCode } from '../lib/sync/teams'
import { syncEngine } from '../lib/sync/engine'

/**
 * Redeem a team invite link of the form `…/teams/join?f=<folderId>&s=<secret>`.
 * Requires Google sign-in; on success it pulls the team's data and switches to it.
 */
export function JoinTeam() {
  const [params] = useSearchParams()
  const { reload } = useActiveContext()
  const folderId = params.get('f') ?? ''
  const secret = params.get('s') ?? ''

  const [status, setStatus] = useState<'idle' | 'joining' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    getAccount().then((a) => setSignedIn(!!a))
  }, [])

  async function join() {
    if (!folderId || !secret) {
      setStatus('error')
      setMessage('This invite link is incomplete.')
      return
    }
    setStatus('joining')
    setMessage(null)
    try {
      const team = await joinByCode(folderId, secret)
      await setActiveScopeProject(`team:${folderId}`)
      syncEngine.syncNow()
      reload()
      setStatus('done')
      setMessage(`Joined "${team.name}".`)
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'Could not join the team.')
    }
  }

  if (!isGoogleConfigured()) {
    return <p className="text-sm text-gray-500">Google sign-in is not configured in this build.</p>
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold">Join a team</h1>
      {signedIn === false && (
        <p className="text-sm text-gray-600">
          Sign in with Google (top right) first, then come back to this link to join.
        </p>
      )}
      {status === 'idle' && signedIn && (
        <>
          <p className="text-sm text-gray-600">
            You were invited to join a shared team. Joining downloads the team's current work to
            this device and syncs your changes back to it.
          </p>
          <button
            type="button"
            onClick={join}
            className="self-start rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Join team
          </button>
        </>
      )}
      {status === 'joining' && <p className="text-sm text-gray-600">Joining…</p>}
      {message && (
        <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>
          {message}
        </p>
      )}
      {status === 'done' && (
        <Link to="/" className="text-sm text-gray-700 underline">
          Go to the dashboard
        </Link>
      )}
    </div>
  )
}
