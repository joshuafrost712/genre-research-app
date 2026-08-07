/**
 * Making a freshly-synced device point at the right project.
 *
 * This is the least obvious part of cloud sync and the easiest to get wrong in a
 * way that looks like sync being broken.
 *
 * Every device auto-creates its own starter project, focus text, genre and
 * worksheet on first run (appState.ensureActiveProject / ensureActiveContext),
 * and the pointers naming which of those is "active" live in the Dexie `meta`
 * table, which is NOT replicated. So a second device pulls your real project
 * down perfectly and then carries on showing you the empty starter it made a
 * moment earlier. Rows arrived, the status chip is green, and your work is
 * invisible. Adoption is what closes that gap: after a pull, point the device at
 * the project that actually has the work in it.
 *
 * The same move serves joining a team, where the shared project's container ids
 * come back from `join_project` rather than being guessed.
 */
import { db } from '../storage/db'
import { setActiveProject, setMetaValue } from '../storage/appState'
import type { JoinedProject } from './supabase/projects'

type Listener = () => void
const listeners = new Set<Listener>()

/** Subscribe to "the active project changed underneath you" (ActiveContextProvider). */
export function onActiveProjectAdopted(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      /* a listener error must not break sync */
    }
  }
}

const activeFocusTextKey = (p: string) => `activeFocusText:${p}`
const activeGenreKey = (p: string) => `activeGenre:${p}`
const activeWorksheetKey = (p: string) => `activeWorksheet:${p}`

/** How much real work a project holds, used to pick between candidates. */
async function entryCount(projectId: string): Promise<number> {
  return db.entries.where('project_id').equals(projectId).count()
}

/**
 * After a sign-in pull, switch to a synced project if the one we are showing is
 * an untouched starter.
 *
 * Deliberately conservative: it only ever moves AWAY from a project with zero
 * entries. Someone who has been working locally keeps their place, and their
 * work is published alongside rather than replaced. Returns true if it switched.
 */
export async function adoptBestProject(
  activeProjectId: string | undefined,
  syncedIds: Set<string>,
): Promise<boolean> {
  if (syncedIds.size === 0) return false

  if (activeProjectId) {
    if (syncedIds.has(activeProjectId)) return false // already on a synced project
    if ((await entryCount(activeProjectId)) > 0) return false // real local work; leave it
  }

  // Prefer the synced project with the most work, then the most recently updated.
  let best: { id: string; entries: number; updated: string } | null = null
  for (const id of syncedIds) {
    const project = await db.projects.get(id)
    if (!project) continue // pulled membership but not the rows yet
    const entries = await entryCount(id)
    const updated = project.updated_at ?? project.created_at ?? ''
    if (
      !best ||
      entries > best.entries ||
      (entries === best.entries && updated > best.updated)
    ) {
      best = { id, entries, updated }
    }
  }

  if (!best || best.id === activeProjectId) return false

  await setActiveProject(best.id)
  await adoptContainers(best.id)
  notify()
  return true
}

/**
 * Point the device's container pointers at a project's existing rows.
 *
 * Without this the device keeps `activeGenre:<project>` unset, `ensureActiveContext`
 * sees nothing, and it helpfully creates "Untitled genre" inside the shared
 * project and syncs it to everyone. Six joiners, six junk genres, and each person
 * still looking at their own.
 *
 * Oldest row of each kind wins so every device independently picks the same one.
 */
export async function adoptContainers(
  projectId: string,
  hint?: Partial<Pick<JoinedProject, 'focus_text_id' | 'genre_id' | 'worksheet_id'>>,
): Promise<void> {
  const oldest = async <T extends { id: string; created_at?: string }>(
    rows: T[],
  ): Promise<string | undefined> =>
    rows.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))[0]?.id

  const focusTextId =
    hint?.focus_text_id ??
    (await oldest(await db.focusTexts.where('project_id').equals(projectId).toArray()))
  const genreId =
    hint?.genre_id ?? (await oldest(await db.genres.where('project_id').equals(projectId).toArray()))
  const worksheetId =
    hint?.worksheet_id ??
    (await oldest(await db.worksheets.where('project_id').equals(projectId).toArray()))

  if (focusTextId) await setMetaValue(activeFocusTextKey(projectId), focusTextId)
  if (genreId) await setMetaValue(activeGenreKey(projectId), genreId)
  if (worksheetId) await setMetaValue(activeWorksheetKey(projectId), worksheetId)
}

/**
 * Switch to a project the user picked, or one they just joined.
 *
 * Order is load-bearing for the join case: the caller must have pulled to
 * completion BEFORE this runs. Setting the active project first would let
 * `ensureActiveContext` race the pull and mint containers into the shared
 * project.
 */
export async function switchToProject(
  projectId: string,
  hint?: Parameters<typeof adoptContainers>[1],
): Promise<void> {
  await setActiveProject(projectId)
  await adoptContainers(projectId, hint)
  notify()
}
