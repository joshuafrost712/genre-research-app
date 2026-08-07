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

export interface SharedProject {
  project_id: string
  name: string
  join_code: string
  role: 'owner' | 'member'
  member_count: number
}

let cache: SharedProject[] | null = null

export function invalidateProjectCache(): void {
  cache = null
}

export async function listMyProjects(force = false): Promise<SharedProject[]> {
  if (!supabase) return []
  if (cache && !force) return cache
  const { data, error } = await supabase.rpc('my_projects')
  if (error) throw new Error(error.message)
  cache = (data ?? []) as SharedProject[]
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
 * Publish every local project worth syncing, on sign-in.
 *
 * "Worth syncing" excludes empty starter projects. Every device auto-creates one
 * on first run (appState.ensureActiveProject), so publishing indiscriminately
 * would fill an account with "Untitled project" rows, one per browser the person
 * ever opened. A project earns a place in the cloud by containing an entry.
 *
 * `includeEmptyActive` is the one exception, and the caller must be careful with
 * it. A brand-new account needs its first, still-empty project published or
 * there is nothing to sync at all. But on a SECOND device the active project is
 * the throwaway starter this browser just made, and publishing that before
 * adoption runs is what makes a person's real work arrive and stay invisible.
 * Pass true only when the account genuinely holds nothing yet.
 */
export async function publishOwnProjects(
  activeProjectId?: string,
  includeEmptyActive = false,
): Promise<number> {
  if (!supabase) return 0

  const already = await syncedProjectIds(true)
  const projects = await db.projects.toArray()
  let published = 0

  for (const p of projects) {
    if (already.has(p.id)) continue
    const hasWork = (await db.entries.where('project_id').equals(p.id).count()) > 0
    if (!hasWork && !(includeEmptyActive && p.id === activeProjectId)) continue
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
