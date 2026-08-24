/**
 * Publishing, joining, and knowing which projects are synced.
 *
 * A "shared project" is just a project the cloud knows about. With one member it
 * is personal cross-device sync; with several it is a team worksheet. Nothing in
 * the schema distinguishes them, which is why Phase 1 and Phase 2 are the same
 * code.
 */
import { supabase } from '../../supabase/client'
import { db } from '../../storage/db'
import { reenqueueProject } from '../outbox'
import { hasWork, substanceOf } from '../substance'
import { getDataOwner } from '../../storage/owner'

/**
 * Refuse to upload local work under an account that does not own it.
 *
 * The engine already wipes the device when a different person signs in, so in
 * ordinary running this is never false. It exists because the consequence of
 * that wipe failing — or being skipped by some future code path that calls
 * publish directly — is one person's worksheets appearing in another person's
 * account, which last-write-wins merging can then propagate over the original.
 * A single `meta` read is a cheap price for making that outcome impossible from
 * two independent directions rather than one.
 */
async function ownsLocalData(): Promise<boolean> {
  // getSession, not getUser: getUser round-trips to the auth server, and this is
  // consulted on a three-second cycle. The stored session's uid is the same uid.
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } }
  const uid = data.session?.user?.id
  if (!uid) return false
  const owner = await getDataOwner()
  // Unstamped is permitted: a device nobody has claimed yet is being claimed by
  // this sign-in, which is the ordinary "worked offline, then signed in" path.
  return !owner.uid || owner.uid === uid
}

export interface SharedProject {
  project_id: string
  name: string
  join_code: string
  role: 'owner' | 'member'
  member_count: number
}

let cache: SharedProject[] | null = null
let cachedAt = 0

/**
 * The list goes stale on its own, and it has to.
 *
 * Local actions (publishing, joining) invalidate it explicitly, but the case
 * that matters is the one no local action can see: your OTHER device publishes a
 * project, or a facilitator adds you to a team. Cache that answer forever and
 * this browser pulls only the projects it happened to know about at sign-in, so
 * a passage added on the laptop never reaches the tablet until someone reloads.
 * Fifteen seconds is slow enough to be nearly free next to a three-second poll,
 * and fast enough that nobody in a room notices the wait.
 */
const CACHE_TTL_MS = 15_000

export function invalidateProjectCache(): void {
  cache = null
  cachedAt = 0
}

export async function listMyProjects(force = false): Promise<SharedProject[]> {
  if (!supabase) return []
  if (cache && !force && Date.now() - cachedAt < CACHE_TTL_MS) return cache
  const { data, error } = await supabase.rpc('my_projects')
  if (error) throw new Error(error.message)
  cache = (data ?? []) as SharedProject[]
  cachedAt = Date.now()
  return cache
}

/** The set the outbox filter and the engine both work from. */
export async function syncedProjectIds(force = false): Promise<Set<string>> {
  return new Set((await listMyProjects(force)).map((p) => p.project_id))
}

/**
 * Publish a local project so it syncs. Idempotent server-side: re-publishing
 * returns the existing join code rather than rotating it, so a double tap never
 * invalidates a code already written on a whiteboard.
 *
 * `reenqueueProject` then walks every existing local record into the outbox, so
 * work created before sign-in is uploaded rather than stranded.
 */
export async function publishProject(projectId: string, name: string): Promise<string> {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  const { data, error } = await supabase.rpc('create_shared_project', {
    p_project: projectId,
    p_name: name,
  })
  if (error) throw new Error(error.message)
  invalidateProjectCache()
  await reenqueueProject(projectId)
  return data as string
}

/**
 * Set the name the whole team sees.
 *
 * This has to be a server call, not just a synced `projects` row, because the
 * team list reads `shared_projects.name` — a column `create_shared_project`
 * writes once and never touches again. That is why every worksheet in the Psalms
 * workshop read "Untitled project" no matter what any device did locally.
 */
export async function renameSharedProject(projectId: string, name: string): Promise<string> {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  const { data, error } = await supabase.rpc('rename_shared_project', {
    p_project: projectId,
    p_name: name,
  })
  if (error) throw new Error(error.message)
  invalidateProjectCache()
  return (data as string) ?? name
}

export interface TeamMember {
  user_id: string
  email: string
  role: 'owner' | 'member'
  joined_at: string
}

/**
 * Who is on the team. "4 members" cannot answer the question a facilitator
 * actually has, which is whether the four are the right four.
 */
export async function listProjectMembers(projectId: string): Promise<TeamMember[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('project_members_list', { p_project: projectId })
  if (error) throw new Error(error.message)
  return (data ?? []) as TeamMember[]
}

export interface JoinedProject {
  project_id: string
  name: string
  focus_text_id: string | null
  genre_id: string | null
  worksheet_id: string | null
}

/**
 * Join by code. The returned container ids are the point: see adoptProject().
 */
export async function joinProject(code: string): Promise<JoinedProject> {
  if (!supabase) throw new Error('Cloud sync is not configured.')
  const { data, error } = await supabase.rpc('join_project', { p_code: code.trim() })
  if (error) {
    if (error.code === 'P0002' || /no team with that code/i.test(error.message ?? '')) {
      throw new Error('No team has that code. Check it and try again.')
    }
    throw new Error(error.message)
  }
  const row = (Array.isArray(data) ? data[0] : data) as JoinedProject | undefined
  if (!row) throw new Error('No team has that code. Check it and try again.')
  invalidateProjectCache()
  return row
}

/**
 * Publish every local project worth syncing.
 *
 * "Worth syncing" excludes the bare pre-gate starters old devices made for
 * themselves on first run. Publishing those indiscriminately fills an account
 * with one "Untitled project" per browser the person has ever opened, and it
 * does something worse than clutter: an empty published project competes for
 * the device's attention with the real one. That is precisely how a passage
 * typed in Safari reached Chrome and stayed invisible there.
 *
 * A project created through the onboarding gate carries a culture/language
 * scope, which counts as work (substance.ts): declaring it was a deliberate
 * act, and the scope has to reach the cloud to reach the person's other
 * devices. So there is no `includeEmptyActive` escape hatch any more. A
 * brand-new account publishes nothing until its owner does something — and
 * creating a scoped project IS doing something.
 */
export async function publishOwnProjects(): Promise<number> {
  if (!supabase) return 0
  if (!(await ownsLocalData())) return 0

  const already = await syncedProjectIds(true)
  const projects = await db.projects.toArray()
  let published = 0

  for (const p of projects) {
    if (already.has(p.id)) continue
    if (!hasWork(await substanceOf(p.id))) continue
    try {
      await publishProject(p.id, p.name)
      published++
    } catch {
      // Most likely someone else published this id (a shared project you left).
      // Not fatal: it simply stays local on this device.
    }
  }

  if (published) invalidateProjectCache()
  return published
}

/**
 * Publish the project being worked in, the moment it stops being a bare starter.
 *
 * This runs every cycle and is the counterpart to not publishing empty starters
 * at sign-in. It is cheap by construction: local Dexie counts decide, and the
 * server is only called when there is genuinely something new to publish.
 *
 * Returns true if it published, meaning the caller should refresh its id set.
 */
export async function publishActiveIfWorked(
  activeProjectId: string | undefined,
  syncedIds: Set<string>,
): Promise<boolean> {
  if (!supabase || !activeProjectId || syncedIds.has(activeProjectId)) return false
  if (!hasWork(await substanceOf(activeProjectId))) return false
  // After the cheap local checks, so the common "nothing new to publish" cycle
  // never pays for it.
  if (!(await ownsLocalData())) return false
  const project = await db.projects.get(activeProjectId)
  if (!project) return false
  try {
    await publishProject(activeProjectId, project.name)
    return true
  } catch {
    return false // retried next cycle; the outbox keeps the work meanwhile
  }
}
