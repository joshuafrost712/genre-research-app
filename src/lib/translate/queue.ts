/**
 * The deferred-translation queue: answers waiting for the zero-metered-cost lane.
 *
 * Follows the existing `outbox` pattern (a Dexie table of pending work, drained by
 * something outside the render path) rather than inventing a new mechanism.
 *
 * The queue is local-only and deliberately not synced. The translation it produces
 * lands on the Entry, which IS synced, so replicating the request as well would let
 * two devices translate the same answer and pay for the work twice.
 *
 * Local-only did NOT mean project-blind, though it was until 2026-08-24. This was
 * the only store with no project dimension, so on a device belonging to several
 * teams the pending count mixed them together and the handoff bundle could carry
 * one team's answers into a Claude session opened for another. Rows now carry
 * `project_id` and every read is scoped to the active team.
 */
import { db } from '../storage/db'
import { getActiveProjectId } from '../storage/appState'
import { entryTranslation, saveEntryTranslation } from '../storage/entries'
import { now } from '../util'
import type { TranslationQueueRow } from '../types'
import type { Locale } from '../i18n/locales'

const MAX_ATTEMPTS = 3

export interface EnqueueArgs {
  text: string
  targetLocale: Locale
  question?: string
  entryId?: string
}

/**
 * Record an answer as needing translation. Idempotent per (entry, locale): a
 * facilitator hammering the button, or an autosave firing repeatedly, must not
 * build a backlog of identical work. Re-enqueuing an entry whose text has since
 * changed REPLACES the stale request rather than adding to it.
 */
export async function enqueueTranslation(args: EnqueueArgs): Promise<void> {
  // Without an entry to attach the result to there is nothing for the worker to
  // write back, so there is nothing worth queuing.
  if (!args.entryId || !args.text.trim()) return

  const existing = await db.translationQueue
    .where('entry_id')
    .equals(args.entryId)
    .filter((r) => r.target_locale === args.targetLocale)
    .toArray()

  for (const row of existing) {
    if (row.source_text === args.text) return // already queued for this exact text
    if (row.seq !== undefined) await db.translationQueue.delete(row.seq)
  }

  const row: TranslationQueueRow = {
    entry_id: args.entryId,
    // Stamped from the ENTRY, not from whatever project happens to be active
    // when this runs: the entry is where the answer actually lives, and the two
    // can differ if a switch lands between the save and the enqueue.
    project_id: (await db.entries.get(args.entryId))?.project_id,
    source_text: args.text,
    target_locale: args.targetLocale,
    question: args.question,
    status: 'pending',
    attempts: 0,
    created_at: now(),
  }
  await db.translationQueue.add(row)
}

/**
 * Keep only the rows belonging to the team the device is standing in.
 *
 * The filter lives here rather than at the call sites on purpose. The queue is
 * local-only working state and every caller wants the same thing — this device,
 * this team — so a parameter would be one more thing a future caller can forget,
 * and forgetting it means a handoff bundle carrying another team's answers into a
 * Claude session. A row queued before `project_id` existed is resolved from its
 * entry rather than dropped, so a queue built this morning still drains.
 */
async function forActiveProject(rows: TranslationQueueRow[]): Promise<TranslationQueueRow[]> {
  const active = await getActiveProjectId()
  if (!active) return rows
  const kept: TranslationQueueRow[] = []
  for (const row of rows) {
    const projectId = row.project_id ?? (await db.entries.get(row.entry_id))?.project_id
    if (projectId === active) kept.push(row)
  }
  return kept
}

/** Work waiting to be translated for the current team, oldest first. */
export async function pendingTranslations(limit = 100): Promise<TranslationQueueRow[]> {
  // Read wider than `limit`, then filter, so a queue holding several teams'
  // work still yields a full batch for this one.
  const rows = await db.translationQueue
    .where('status')
    .equals('pending')
    .limit(limit * 4)
    .toArray()
  return (await forActiveProject(rows)).slice(0, limit)
}

export async function pendingCount(): Promise<number> {
  const rows = await db.translationQueue.where('status').equals('pending').toArray()
  return (await forActiveProject(rows)).length
}

/**
 * Attach a completed translation to its entry and clear the queue row.
 *
 * Refuses to write when the answer has changed since the request was queued: the
 * translation would describe text the team has already replaced, which is exactly
 * the stale-translation failure the Entry write path guards against.
 */
export async function completeTranslation(
  seq: number,
  translation: string,
): Promise<'applied' | 'stale' | 'missing'> {
  const row = await db.translationQueue.get(seq)
  if (!row) return 'missing'
  const entry = await db.entries.get(row.entry_id)
  if (!entry) {
    await db.translationQueue.delete(seq)
    return 'missing'
  }
  if (entry.text !== row.source_text) {
    await db.translationQueue.delete(seq)
    return 'stale'
  }
  await saveEntryTranslation(row.entry_id, row.target_locale, translation)
  await db.translationQueue.delete(seq)
  return 'applied'
}

/** Record a failed attempt; give up (and stop retrying) after MAX_ATTEMPTS. */
export async function failTranslation(seq: number, error: string): Promise<void> {
  const row = await db.translationQueue.get(seq)
  if (!row) return
  const attempts = row.attempts + 1
  await db.translationQueue.update(seq, {
    attempts,
    last_error: error.slice(0, 300),
    status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
  })
}

/**
 * Drop queued work that is already done or no longer needed, so a queue inspected
 * by the operator reflects real outstanding work.
 */
export async function pruneTranslationQueue(): Promise<number> {
  const rows = await db.translationQueue.toArray()
  let removed = 0
  for (const row of rows) {
    if (row.seq === undefined) continue
    const entry = await db.entries.get(row.entry_id)
    const done = entry && entryTranslation(entry, row.target_locale) !== undefined
    const changed = entry && entry.text !== row.source_text
    if (!entry || done || changed) {
      await db.translationQueue.delete(row.seq)
      removed += 1
    }
  }
  return removed
}
