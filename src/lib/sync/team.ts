/**
 * Sharing a worksheet with a team, and joining one.
 *
 * The ordering inside `joinAndAdopt` is the whole reason this file exists rather
 * than the page calling `joinProject` and `switchToProject` itself. Get the order
 * wrong and the failure is invisible: rows replicate, the status chip goes green,
 * and every member sits looking at their own empty starter worksheet. In a room
 * that is indistinguishable from sync being broken, and it cannot be diagnosed
 * from the screen. Putting the sequence behind one function means no caller can
 * reintroduce it.
 */
import { db } from '../storage/db'
import { getAuthorId } from './author'
import { pullProject, resetCursor } from './supabase/pull'
import { joinProject, publishProject, invalidateProjectCache } from './supabase/projects'
import { switchToProject } from './adopt'
import { getActiveProjectId } from '../storage/appState'

export interface JoinOutcome {
  projectId: string
  name: string
  /** Rows brought down. Zero means the team has been created but nobody has typed. */
  applied: number
}

/**
 * Join by code and land on the shared worksheet, ready to work.
 *
 * Order, and every step matters:
 *  1. Join, which also returns the team's container ids. Entries are addressed by
 *     focus text / genre / worksheet, and those pointers live in local `meta`,
 *     which is never replicated, so the ids have to come from the server.
 *  2. Pull to COMPLETION. Switching first would let ensureActiveContext race the
 *     pull, find an apparently empty project, and helpfully mint an "Untitled
 *     genre" into the shared worksheet, once per joiner.
 *  3. Only then switch and adopt the containers.
 */
export async function joinAndAdopt(code: string): Promise<JoinOutcome> {
  const joined = await joinProject(code)

  await resetCursor(joined.project_id)
  const authorId = await getAuthorId()
  const { applied } = await pullProject(joined.project_id, authorId)

  await switchToProject(joined.project_id, {
    focus_text_id: joined.focus_text_id,
    genre_id: joined.genre_id,
    worksheet_id: joined.worksheet_id,
  })

  return { projectId: joined.project_id, name: joined.name, applied }
}

/**
 * Share the project currently open, returning its join code.
 *
 * The facilitator should set up the focus text and genres BEFORE sharing the
 * code. Not a technical constraint, an operational one, and the difference
 * between one worksheet and seven: whoever creates the containers owns them, and
 * a member whose device creates its own is working alone inside a shared project.
 */
export async function shareActiveProject(): Promise<{ code: string; projectId: string }> {
  const projectId = await getActiveProjectId()
  if (!projectId) throw new Error('No project is open.')
  const project = await db.projects.get(projectId)
  const code = await publishProject(projectId, project?.name ?? 'Shared worksheet')
  invalidateProjectCache()
  return { code, projectId }
}
