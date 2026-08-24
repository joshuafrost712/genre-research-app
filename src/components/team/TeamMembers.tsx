/**
 * Who is actually on the team.
 *
 * "4 members" cannot answer the question a facilitator has, which is whether the
 * four are the right four. At the Psalms workshop a member who shared their own
 * worksheet instead of joining produced a second team of one that looked
 * identical to the real one; a list of emails makes that visible in a glance
 * instead of after twenty minutes of lost work.
 *
 * Emails, because that is what people signed in with and already know about each
 * other in a workshop room. Visible to fellow members only — the RPC checks
 * membership server-side, so this component cannot leak by being rendered in the
 * wrong place.
 */
import { useEffect, useState } from 'react'
import { listProjectMembers, type TeamMember } from '../../lib/sync/supabase/projects'
import { useSupabaseSession } from '../../lib/supabase/session'

export function TeamMembers({ projectId }: { projectId: string }) {
  const { user } = useSupabaseSession()
  const [members, setMembers] = useState<TeamMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setMembers(null)
    setError(null)
    listProjectMembers(projectId)
      .then((rows) => {
        if (!cancelled) setMembers(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the team list.')
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!members) return <p className="text-xs text-gray-400">Loading the team…</p>

  return (
    <ul className="flex flex-col gap-1">
      {members.map((m) => (
        <li key={m.user_id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-700">
          <span className="truncate">{m.email}</span>
          {m.user_id === user?.id && <span className="text-xs text-gray-500">(you)</span>}
          {m.role === 'owner' && (
            <span className="text-xs text-gray-500">set up this team</span>
          )}
        </li>
      ))}
    </ul>
  )
}
