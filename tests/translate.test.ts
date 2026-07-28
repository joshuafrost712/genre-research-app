import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { ensureActiveContext } from '../src/lib/storage/appState'
import { entryTranslation, findEntry, upsertEntry } from '../src/lib/storage/entries'
import {
  completeTranslation,
  enqueueTranslation,
  failTranslation,
  pendingCount,
  pendingTranslations,
  pruneTranslationQueue,
} from '../src/lib/translate/queue'
import { CONTRACT_PATH, renderContract } from '../src/lib/translate/contract'
import {
  buildSystemPrompt,
  buildUserMessage,
  TRANSLATE_OUTPUT_SCHEMA,
} from '../src/lib/translate/prompt'

const NODE = 's0.purpose.general'
const LAYER = 'focusText' as const

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.entries.clear(),
    db.translationQueue.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

describe('the generated Edge Function contract', () => {
  it('is in sync with the glossary and prompt', () => {
    // The Edge Function cannot import from src/, so it reads a committed copy.
    // If this fails, run `npm run i18n:contract`. Without this guard a glossary
    // edit would leave the deployed function serving stale terminology, and the
    // symptom would be inconsistent Indonesian rather than a broken build.
    const committed = readFileSync(resolve(__dirname, '..', CONTRACT_PATH), 'utf8')
    expect(committed).toBe(renderContract())
  })
})

describe('the translation prompt', () => {
  const system = buildSystemPrompt('id')

  it('pins the app-critical glossary terms', () => {
    expect(system).toContain('Required -> Wajib')
    expect(system).toContain('Common -> Lazim')
    expect(system).toContain('passage -> perikop')
  })

  it('forbids translating interpolation tokens', () => {
    expect(system).toContain('{genre}')
    expect(system).toContain('{passage}')
    expect(system).toMatch(/Never translate or alter these/)
  })

  it('tells the model to translate rather than answer or tidy the note', () => {
    // Field notes are fragmentary. A model that "helps" by completing them would
    // put words in a team's mouth.
    expect(system).toMatch(/Do not tidy it, expand it, summarise it, or answer it/)
  })

  it('constrains output to a bare translation', () => {
    // Without a schema the model tends to reply "Here is the translation: …",
    // and that preamble would be saved into the team's field.
    expect(TRANSLATE_OUTPUT_SCHEMA.required).toContain('translation')
    expect(TRANSLATE_OUTPUT_SCHEMA.additionalProperties).toBe(false)
  })

  it('fences the question as context, not as content to translate', () => {
    const msg = buildUserMessage({
      text: 'sung by women only',
      targetLocale: 'id',
      question: 'Who takes part in {genre}?',
    })
    expect(msg).toMatch(/do NOT translate this/)
    expect(msg).toContain('Who takes part in {genre}?')
    expect(msg).toContain('sung by women only')
  })

  it('omits the context block when there is no question', () => {
    const msg = buildUserMessage({ text: 'sung by women only', targetLocale: 'id' })
    expect(msg).not.toMatch(/Context/)
  })
})

describe('deferred translation queue', () => {
  beforeEach(clearDb)

  it('ignores a request with nothing to attach the result to', async () => {
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id' })
    expect(await pendingCount()).toBe(0)
  })

  it('queues one row per entry and locale, idempotently', async () => {
    const ctx = await ensureActiveContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    const args = { text: 'to encourage', targetLocale: 'id' as const, entryId: e.id }
    await enqueueTranslation(args)
    await enqueueTranslation(args)
    await enqueueTranslation(args)
    // A facilitator pressing the button repeatedly must not build a backlog.
    expect(await pendingCount()).toBe(1)
  })

  it('replaces a queued request when the answer has since been rewritten', async () => {
    const ctx = await ensureActiveContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'first' })
    await enqueueTranslation({ text: 'first', targetLocale: 'id', entryId: e.id })
    await enqueueTranslation({ text: 'second', targetLocale: 'id', entryId: e.id })
    const rows = await pendingTranslations()
    expect(rows).toHaveLength(1)
    expect(rows[0].source_text).toBe('second')
  })

  it('applies a completed translation to the entry', async () => {
    const ctx = await ensureActiveContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id', entryId: e.id })
    const [row] = await pendingTranslations()

    expect(await completeTranslation(row.seq!, 'untuk menguatkan')).toBe('applied')
    expect(entryTranslation(await findEntry(ctx, NODE, LAYER), 'id')).toBe('untuk menguatkan')
    expect(await pendingCount()).toBe(0)
  })

  it('refuses to apply a translation of text the team has since replaced', async () => {
    const ctx = await ensureActiveContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id', entryId: e.id })
    const [row] = await pendingTranslations()

    // The team edits while the worker is mid-flight.
    await upsertEntry(ctx, NODE, LAYER, { text: 'to lament' })

    expect(await completeTranslation(row.seq!, 'untuk menguatkan')).toBe('stale')
    expect((await findEntry(ctx, NODE, LAYER))?.translations).toBeUndefined()
    expect(await pendingCount()).toBe(0)
  })

  it('drops work whose entry has been deleted', async () => {
    const ctx = await ensureActiveContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id', entryId: e.id })
    const [row] = await pendingTranslations()
    await db.entries.delete(e.id)
    expect(await completeTranslation(row.seq!, 'apa pun')).toBe('missing')
  })

  it('retries a few times then gives up', async () => {
    const ctx = await ensureActiveContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id', entryId: e.id })
    const [row] = await pendingTranslations()

    await failTranslation(row.seq!, 'network down')
    expect(await pendingCount()).toBe(1) // still retryable
    await failTranslation(row.seq!, 'network down')
    await failTranslation(row.seq!, 'network down')
    // Given up: no longer offered as pending, so the worker stops burning calls.
    expect(await pendingCount()).toBe(0)
    expect((await db.translationQueue.get(row.seq!))?.status).toBe('failed')
  })

  it('prunes work that is already done or no longer needed', async () => {
    const ctx = await ensureActiveContext()
    const done = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id', entryId: done.id })
    const [row] = await pendingTranslations()
    await completeTranslation(row.seq!, 'untuk menguatkan')

    // Re-queue the same, now-translated answer, plus work for a vanished entry.
    await enqueueTranslation({ text: 'to encourage', targetLocale: 'id', entryId: done.id })
    await db.translationQueue.add({
      entry_id: 'gone',
      source_text: 'x',
      target_locale: 'id',
      status: 'pending',
      attempts: 0,
      created_at: new Date().toISOString(),
    })

    expect(await pruneTranslationQueue()).toBe(2)
    expect(await pendingCount()).toBe(0)
  })
})
