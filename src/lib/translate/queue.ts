/**
 * The deferred-translation queue: answers waiting for the zero-metered-cost lane.
 *
 * Follows the existing `outbox` pattern (a Dexie table of pending work, drained by
 * something outside the render path) rather than inventing a new mechanism.
 *
 * The queue is local-only and deliberately not synced. The translation it produces
 * lands on the Entry, which IS synced, so replicating the request as well would let
 * two devices translate the same answer and pay for the work twice.
 */
import { db } from '../storage/db'
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
    source_text: args.text,
    target_locale: args.targetLocale,
    question: args.question,
    status: 'pending',
    attempts: 0,
    created_at: now(),
  }
  await db.translationQueue.add(row)
}

/** Work waiting to be translated, oldest first. */
export async function pendingTranslations(limit = 100): Promise<TranslationQueueRow[]> {
  return db.translationQueue.where('status').equals('pending').limit(limit).toArray()
}

export async function pendingCount(): Promise<number> {
  return db.translationQueue.where('status').equals('pending').count()
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
