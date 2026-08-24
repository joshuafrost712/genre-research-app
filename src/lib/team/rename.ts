/**
 * Naming a team, both halves at once.
 *
 * A team's name lives in two places, and that split is why the Psalms workshop
 * saw "Untitled project" everywhere:
 *
 *  - Dexie `projects.name`, which replicates through sync_records like any other
 *    record. This is the name a device shows for a project the cloud does not
 *    know about.
 *  - Postgres `shared_projects.name`, which is what `my_projects()` returns and
 *    therefore what every team list on every device reads. `create_shared_project`
 *    writes it on first insert and never again.
 *
 * Writing only the first leaves the team list unchanged, which reads as a rename
 * that did not save. Writing only the second leaves the device's own label stale
 * until the next pull. So this writes both, server first: if the server call
 * fails (offline, not a member) nothing local changes either, and the person sees
 * an error instead of a name only they can see.
 */
import { renameProject, cleanProjectName } from '../storage/appState'
import { renameSharedProject } from '../sync/supabase/projects'

export async function renameTeam(
  projectId: string,
  name: string,
  opts: { shared: boolean },
): Promise<string> {
  const clean = cleanProjectName(name)
  if (!clean) throw new Error('Give the team a name first.')
  if (opts.shared) await renameSharedProject(projectId, clean)
  await renameProject(projectId, clean)
  return clean
}
