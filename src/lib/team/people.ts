/**
 * Turning an account id into a name a person in the room recognises.
 *
 * The server knows teammates by email and nothing else: `project_members_list`
 * joins `auth.users` for an address, and there is no display-name column
 * anywhere. Emails are what people signed in with and already know about each
 * other in a workshop, so they are the identifier available, and the local part
 * of an address is usually a name with punctuation in it.
 *
 * So this prettifies where prettifying is safe and shows the address where it is
 * not. The exact address always stays available in a `title`, because a guess
 * that reads as a name must never be the only thing on screen.
 */
import { useEffect, useState } from 'react'
import { listProjectMembers } from '../sync/supabase/projects'

/**
 * "josh_frost@sil.org" gives "Josh Frost"; "jf23@sil.org" gives the address
 * back unchanged. The separator is the whole signal: a local part that splits
 * on `.`, `_` or `-` is nearly always first-and-last, and one that does not
 * could be anything, so capitalising it would be inventing a name.
 */
export function personLabel(email: string): string {
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length < 2) return email
  // A part that is not a plain word (an employee number, a stray digit run) is
  // not a name either, and one of those makes the whole guess untrustworthy.
  if (!parts.every((p) => /^[a-z]+$/i.test(p))) return email
  return parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

/**
 * Member emails per project, fetched once and kept.
 *
 * FAILURE IS CACHED TOO, and that is not laziness. `listProjectMembers` throws
 * on any error, the RPC itself raises for a non-member, and offline is the
 * normal condition in the room this app is used in. A cache that only remembers
 * successes would retry the same doomed call for every toast, on a loop that
 * pulls every three seconds.
 */
const cache = new Map<string, Map<string, string> | null>()
const inflight = new Map<string, Promise<void>>()

async function loadMembers(projectId: string): Promise<void> {
  if (cache.has(projectId)) return
  let pending = inflight.get(projectId)
  if (!pending) {
    pending = (async () => {
      try {
        const members = await listProjectMembers(projectId)
        cache.set(projectId, new Map(members.map((m) => [m.user_id, m.email])))
      } catch {
        cache.set(projectId, null) // asked, and the answer is not available
      } finally {
        inflight.delete(projectId)
      }
    })()
    inflight.set(projectId, pending)
  }
  return pending
}

/** Forget what we know about a team's members (they changed, or you signed out). */
export function forgetMembers(projectId?: string): void {
  if (projectId) cache.delete(projectId)
  else cache.clear()
}

export interface MemberLabel {
  /** A recognisable name, or null when it cannot be resolved. */
  label: string | null
  /** The exact address behind that label, for a `title`. */
  email: string | null
}

/**
 * The name behind an account id, or nulls.
 *
 * Nulls are a supported answer, not a loading artefact to design around: the
 * writer may be signed out, on an older client, or simply unreachable because
 * the device is offline. Every caller must have a sentence that works without a
 * name.
 */
export function useMemberLabel(
  projectId: string | null | undefined,
  userId: string | null | undefined,
): MemberLabel {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    setEmail(null)
    if (!projectId || !userId) return
    let active = true
    void loadMembers(projectId).then(() => {
      if (!active) return
      setEmail(cache.get(projectId)?.get(userId) ?? null)
    })
    return () => {
      active = false
    }
  }, [projectId, userId])

  return { label: email ? personLabel(email) : null, email }
}
