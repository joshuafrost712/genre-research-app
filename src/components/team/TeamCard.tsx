/**
 * The team, on Home.
 *
 * Home is where people land, so this is where "whose data am I about to type
 * into?" should be answered without anybody navigating anywhere. It carries the
 * name (with rename), the count, the join code, and the way into another team —
 * the four things a facilitator was previously asked to find behind the tenth
 * link in the menu.
 *
 * Compact on purpose. The full picture, including who is on the team by email,
 * is on /teams; this is the glance.
 */
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useTeam } from '../TeamProvider'
import { TeamNameField } from './TeamNameField'
import { JoinCodeRow } from './JoinCodeRow'
import { describeMembers } from '../../lib/team/describe'
import { switchToProject } from '../../lib/sync/adopt'
import { syncEngine } from '../../lib/sync/engine'
import { useActiveContext } from '../ActiveContextProvider'

export function TeamCard() {
  const { ready, configured, signedIn, current, otherTeams, refresh } = useTeam()
  const { reload } = useActiveContext()
  const [busy, setBusy] = useState(false)

  if (!configured || !ready || !current) return null

  const shared = current.shared && current.memberCount > 1

  const open = async (projectId: string) => {
    setBusy(true)
    try {
      await switchToProject(projectId)
      reload()
      syncEngine.syncNow()
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className={`rounded-2xl border p-4 ${
        shared ? 'border-sky-200 bg-sky-50/60' : 'border-amber-200 bg-amber-50/60'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {shared ? 'Your team' : 'Your own worksheet'}
          </div>
          <div className="mt-1">
            {/* Signed out there is no team to name, and no server to name it on. */}
            {signedIn ? (
              <TeamNameField />
            ) : (
              <p className="text-sm text-gray-700">
                Sign in to work with a team. On this device, answers are saved locally.
              </p>
            )}
          </div>
        </div>
        <Link
          to="/teams"
          className="shrink-0 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          {shared ? 'Team page' : 'Share or join'}
        </Link>
      </div>

      {signedIn && (
        <div className="mt-3 space-y-2 text-sm">
          {shared ? (
            <>
              <p className="text-gray-700">
                Shared with {describeMembers(current.memberCount)}. Everything you write here
                goes to this team.
              </p>
              {current.joinCode && (
                <div>
                  <p className="text-xs text-gray-500">Join code for anyone still joining:</p>
                  <div className="mt-1">
                    <JoinCodeRow code={current.joinCode} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-amber-900">
              Nothing here is shared. Your passages, genres and answers stay on your own
              worksheet until you share it or join a team.
            </p>
          )}

          {otherTeams.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-gray-500">Switch to:</span>
              {otherTeams.map((team) => (
                <button
                  key={team.projectId}
                  type="button"
                  onClick={() => open(team.projectId)}
                  disabled={busy}
                  className="max-w-[14rem] truncate rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {team.named ? team.name : `No name yet (${describeMembers(team.memberCount)})`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
