/**
 * How much a project actually holds.
 *
 * Two decisions need this and they must agree, or the app contradicts itself:
 * whether a project is worth publishing to the cloud, and which of several
 * projects a device should be pointed at. Answer them with different rules and
 * you get the failure this module exists to prevent — a device publishes its
 * empty starter, that starter then counts as "a synced project", and adoption
 * concludes the device is already in the right place while the person's real
 * worksheet sits one project over, fully downloaded and invisible.
 *
 * Projects used to be born silently (every device auto-created an 'Untitled
 * project' starter on first run), so the baseline shape — one project, one
 * unnamed focus text, one unnamed genre, no answers — counted as nothing.
 * Since the onboarding gate, a new project only exists because a person either
 * joined a team or declared a culture and a language for it. That declaration
 * is a deliberate act, so a scoped project counts as work even before it has
 * answers: it must publish (or the culture/language never reach the cloud) and
 * adoption must not silently displace it. Pre-gate starter rows on existing
 * devices still carry no culture/language and still count as nothing.
 * `hasWork` stays deliberately broader than "are there answers": setting up the
 * passages for tomorrow's session is work, and it has to reach the other device.
 */
import { db } from '../storage/db'

/** The reference `ensureActiveFocusText` gives a starter it had to invent. */
const DEFAULT_FOCUS_TEXT = 'Untitled focus text'

export interface Substance {
  entries: number
  focusTexts: number
  genres: number
  /** Focus texts someone actually named, e.g. "Psalm 124". */
  named: number
  /** The person declared a culture/language for this project (onboarding gate
   * or the Team page). Scoped-but-empty scores low, so real work still ranks
   * above it in adoption; this flag only makes it publishable and un-displaceable. */
  scoped: boolean
  /** A single number for ranking. Answers dominate, then named passages. */
  score: number
}

export async function substanceOf(projectId: string): Promise<Substance> {
  const [entries, focusTextRows, genres, project] = await Promise.all([
    db.entries.where('project_id').equals(projectId).count(),
    db.focusTexts.where('project_id').equals(projectId).toArray(),
    db.genres.where('project_id').equals(projectId).count(),
    db.projects.get(projectId),
  ])
  const named = focusTextRows.filter(
    (f) => (f.reference ?? '').trim() && f.reference !== DEFAULT_FOCUS_TEXT,
  ).length
  const scoped = Boolean((project?.culture ?? '').trim() || (project?.language ?? '').trim())
  return {
    entries,
    focusTexts: focusTextRows.length,
    genres,
    named,
    scoped,
    score: entries * 1000 + named * 10 + focusTextRows.length + genres,
  }
}

/**
 * Did anyone do anything in here, or is it a starter the app made by itself?
 *
 * Answers, a named passage, more than one container of either kind, or a
 * declared culture/language scope all count. A bare pre-gate starter does not,
 * which is what keeps an account from filling up with one "Untitled project"
 * per browser the person has ever opened.
 */
export function hasWork(s: Substance): boolean {
  return s.scoped || s.entries > 0 || s.named > 0 || s.focusTexts > 1 || s.genres > 1
}
