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
 * Every device auto-creates a starter on first run: one project, one unnamed
 * focus text, one unnamed genre, no answers (appState.ensureActiveContext). That
 * shape is the baseline. `hasWork` is the question "did a human do anything
 * here", and it is deliberately broader than "are there answers": setting up the
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
  /** A single number for ranking. Answers dominate, then named passages. */
  score: number
}

export async function substanceOf(projectId: string): Promise<Substance> {
  const [entries, focusTextRows, genres] = await Promise.all([
    db.entries.where('project_id').equals(projectId).count(),
    db.focusTexts.where('project_id').equals(projectId).toArray(),
    db.genres.where('project_id').equals(projectId).count(),
  ])
  const named = focusTextRows.filter(
    (f) => (f.reference ?? '').trim() && f.reference !== DEFAULT_FOCUS_TEXT,
  ).length
  return {
    entries,
    focusTexts: focusTextRows.length,
    genres,
    named,
    score: entries * 1000 + named * 10 + focusTextRows.length + genres,
  }
}

/**
 * Did anyone do anything in here, or is it the starter the app made by itself?
 *
 * Answers, a named passage, or more than one container of either kind all count.
 * A bare starter does not, which is what keeps an account from filling up with
 * one "Untitled project" per browser the person has ever opened.
 */
export function hasWork(s: Substance): boolean {
  return s.entries > 0 || s.named > 0 || s.focusTexts > 1 || s.genres > 1
}
