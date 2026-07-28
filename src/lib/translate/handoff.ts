/**
 * The zero-metered-cost translation lane: a file/clipboard handoff to Claude
 * running on a Max subscription.
 *
 * WHY THIS SHAPE. The original plan had a worker polling a cloud database. That
 * was wrong about this codebase: sync writes per-author shard files to GOOGLE
 * DRIVE (see lib/sync/flush.ts), Supabase is the identity layer only, and the
 * pending queue lives in the browser's IndexedDB, which no external process can
 * read. Rather than teach a Node worker to rewrite Drive shards — the one place a
 * bug would corrupt other people's synced answers — this reuses the handoff the
 * app already uses for AI note routing (src/ai, src/routing, and the Routing
 * page): the app emits a bundle, Claude does the work, the app imports the reply.
 *
 * That keeps Joshua's no-metered-API pattern intact, needs no key and no new auth,
 * and cannot corrupt sync state, at the cost of being operator-driven rather than
 * autonomous.
 */
import { db } from '../storage/db'
import { findSourceNode } from '../content/loader'
import { LOCALE_LABELS, type Locale } from '../i18n/locales'
import { glossaryFor } from './prompt'
import { completeTranslation, failTranslation, pendingTranslations } from './queue'

export interface TranslationBundle {
  text: string
  count: number
}

interface BundleItem {
  seq: number
  targetLocale: string
  question?: string
  text: string
}

/**
 * A self-contained instruction sheet plus the work. Self-contained on purpose: it
 * is pasted into a fresh Claude session that has none of this repo's context, so
 * the glossary and the rules travel with the request.
 */
export async function buildTranslationBundle(limit = 200): Promise<TranslationBundle> {
  const rows = await pendingTranslations(limit)
  const items: BundleItem[] = rows
    .filter((r) => r.seq !== undefined)
    .map((r) => ({
      seq: r.seq!,
      targetLocale: r.target_locale,
      question: r.question ?? findSourceNode(r.entry_id)?.node.label,
      text: r.source_text,
    }))

  if (items.length === 0) {
    return { text: '', count: 0 }
  }

  const locales = Array.from(new Set(items.map((i) => i.targetLocale)))
  const lines: string[] = [
    '# Translate worksheet answers',
    '',
    'These are research notes typed by a Bible-translation team studying the song,',
    'poetry, and story forms of their own community. Translate each `text` into the',
    'language named by its `targetLocale`.',
    '',
    'Rules:',
    '- Translate what is there. Do not tidy, expand, summarise, or answer it. A',
    '  fragment stays a fragment.',
    '- Keep the length close to the original and preserve line breaks.',
    '- `question` is the worksheet question being answered. It is context to',
    '  disambiguate short answers; do NOT translate it.',
    '- Add no commentary, alternatives, or notes about your choices.',
    '- If a `text` is already in the target language, return it unchanged.',
    '',
  ]

  for (const locale of locales) {
    const glossary = glossaryFor(locale as Locale)
    if (!glossary) continue
    lines.push(
      `## Required terminology for ${LOCALE_LABELS[locale as Locale] ?? locale}`,
      '',
      'Use these renderings so the same idea is never expressed two ways:',
      '',
      ...glossary.terms.map((t) => `- ${t.en} -> ${t.id}`),
      '',
      'Never translate or alter these; reproduce them character for character:',
      '',
      ...glossary.doNotTranslate.map((d) => `- ${d}`),
      '',
    )
  }

  lines.push(
    '## Work',
    '',
    '```json',
    JSON.stringify(items, null, 2),
    '```',
    '',
    '## Reply with ONLY this shape',
    '',
    'One object per item, matching `seq` exactly. No prose before or after.',
    '',
    '```json',
    JSON.stringify([{ seq: items[0].seq, translation: '…' }], null, 2),
    '```',
  )

  return { text: lines.join('\n'), count: items.length }
}

export interface ImportResult {
  applied: number
  /** Answers edited since the request was made; their translations were discarded. */
  stale: number
  /** Entries that no longer exist. */
  missing: number
  /** Reply entries that did not match anything queued. */
  unmatched: number
}

/**
 * Extract the JSON array from a Claude reply.
 *
 * Tolerant on purpose: a pasted reply may or may not be fenced, and may carry a
 * sentence of preamble however firmly the bundle asked it not to. Being strict
 * here would mean an operator losing a batch of finished work to a stray "Here
 * you go:".
 */
function parseReply(raw: string): { seq: number; translation: string }[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], raw].filter((c): c is string => typeof c === 'string')

  for (const candidate of candidates) {
    const start = candidate.indexOf('[')
    const end = candidate.lastIndexOf(']')
    if (start === -1 || end <= start) continue
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
      if (!Array.isArray(parsed)) continue
      return parsed
        .filter(
          (p): p is { seq: number; translation: string } =>
            typeof p === 'object' &&
            p !== null &&
            typeof (p as { seq?: unknown }).seq === 'number' &&
            typeof (p as { translation?: unknown }).translation === 'string',
        )
        .filter((p) => p.translation.trim().length > 0)
    } catch {
      continue
    }
  }
  return []
}

/** Apply a Claude reply, honouring the same staleness rule as the interactive lane. */
export async function importTranslationReply(raw: string): Promise<ImportResult> {
  const items = parseReply(raw)
  const result: ImportResult = { applied: 0, stale: 0, missing: 0, unmatched: 0 }

  for (const item of items) {
    const row = await db.translationQueue.get(item.seq)
    if (!row) {
      result.unmatched += 1
      continue
    }
    const outcome = await completeTranslation(item.seq, item.translation)
    if (outcome === 'applied') result.applied += 1
    else if (outcome === 'stale') result.stale += 1
    else result.missing += 1
  }
  return result
}

/**
 * Mark everything currently pending as attempted, for when an operator gives up on
 * a batch. Keeps the queue honest rather than showing work nobody will do.
 */
export async function abandonPendingTranslations(reason = 'abandoned by operator'): Promise<number> {
  const rows = await pendingTranslations(1000)
  for (const row of rows) {
    if (row.seq !== undefined) await failTranslation(row.seq, reason)
  }
  return rows.length
}
