/**
 * Making a freshly-synced device point at the right project.
 *
 * This is the least obvious part of cloud sync and the easiest to get wrong in a
 * way that looks like sync being broken.
 *
 * The pointers naming which project/containers are "active" live in the Dexie
 * `meta` table, which is NOT replicated. So a second device can pull your real
 * project down perfectly and carry on showing whatever it was pointed at (or,
 * behind the onboarding gate, nothing at all). Rows arrived, the status chip is
 * green, and your work is invisible. Adoption is what closes that gap: after a
 * pull, point the device at the project that actually has the work in it.
 * (Until 2026-08 every device also auto-created its own empty starter on first
 * run — the onboarding gate replaced that, so a fresh device now adopts from a
 * blank slate; a scoped-but-empty project counts as work, see substance.ts.)
 *
 * The same move serves joining a team, where the shared project's container ids
 * come back from `join_project` rather than being guessed.
 */
import { db } from '../storage/db'
import { getMetaValue, setActiveProject, setMetaValue } from '../storage/appState'
import { hasWork, substanceOf } from './substance'
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

/**
 * The project the person chose by hand, from the picker or by joining a code.
 *
 * Adoption must never override a deliberate choice. Without this, opening an
 * empty worksheet on purpose (to set the next team up, say) would get you yanked
 * back to whichever project has the most in it, on the next three-second poll.
 */
const PINNED_PROJECT = 'projectPinnedByUser'

async function pinnedProjectId(): Promise<string | undefined> {
  return getMetaValue(PINNED_PROJECT)
}

/**
 * After a pull, point this device at the project that actually holds the work.
 *
 * The rule is narrow on purpose: it moves only away from a project that holds
 * **nothing at all** — the bare starter this browser minted for itself — and
 * only towards one where somebody has done something. So it can never displace
 * work, it can never hop a device off a worksheet it is already showing because
 * a busier one appeared, and two devices can never trade places on alternate
 * polls. A device adopts at most once, then stays put.
 *
 * It runs on EVERY cycle, not only the first one after sign-in, and it does not
 * care whether the current project is itself synced. Both of those were wrong
 * before, and together they produced the exact bug this rewrite fixes: two
 * browsers signed into one account each published their own empty starter, each
 * then satisfied "you are already on a synced project", and neither ever
 * converged. A passage added in Safari replicated to Chrome within seconds and
 * Chrome went on showing a different, empty project. The rows were never the
 * problem; the pointer was.
 */
export async function adoptBestProject(
  activeProjectId: string | undefined,
  syncedIds: Set<string>,
): Promise<boolean> {
  if (syncedIds.size === 0) return false

  if (activeProjectId) {
    if ((await pinnedProjectId()) === activeProjectId) return false // their choice, not ours
    if (hasWork(await substanceOf(activeProjectId))) return false // something is here; stay
  }

  // The best candidate by (score, updated_at, id). Every device computes the
  // same order from the same rows, so they converge on one project rather than
  // chasing each other.
  let best: { id: string; score: number; updated: string } | null = null
  for (const id of syncedIds) {
    const project = await db.projects.get(id)
    if (!project) continue // membership known, rows not pulled yet
    const s = await substanceOf(id)
    if (!hasWork(s)) continue // an empty starter is never worth adopting
    const updated = project.updated_at ?? project.created_at ?? ''
    if (
      !best ||
      s.score > best.score ||
      (s.score === best.score && updated > best.updated) ||
      (s.score === best.score && updated === best.updated && id > best.id)
    ) {
      best = { id, score: s.score, updated }
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
  // Pin before adopting containers, so a poll landing in between cannot decide
  // this deliberate move was a stranded starter and undo it.
  await setMetaValue(PINNED_PROJECT, projectId)
  await adoptContainers(projectId, hint)
  notify()
}
