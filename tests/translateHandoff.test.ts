import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { ensureActiveContext } from '../src/lib/storage/appState'
import { entryTranslation, findEntry, upsertEntry } from '../src/lib/storage/entries'
import { enqueueTranslation, pendingCount, pendingTranslations } from '../src/lib/translate/queue'
import {
  abandonPendingTranslations,
  buildTranslationBundle,
  importTranslationReply,
} from '../src/lib/translate/handoff'

const NODE = 's0.purpose.general'
const LAYER = 'focusText' as const

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.entries.clear(),
    db.translationQueue.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

async function queueOne(text = 'sung only by women at funerals') {
  const ctx = await ensureActiveContext()
  const e = await upsertEntry(ctx, NODE, LAYER, { text })
  await enqueueTranslation({ text, targetLocale: 'id', entryId: e.id, question: 'Who takes part?' })
  const [row] = await pendingTranslations()
  return { ctx, entry: e, seq: row.seq! }
}

describe('zero-cost lane handoff bundle', () => {
  beforeEach(clearDb)

  it('is empty when there is nothing to do', async () => {
    const bundle = await buildTranslationBundle()
    expect(bundle.count).toBe(0)
    expect(bundle.text).toBe('')
  })

  it('carries the work, the glossary, and the reply shape', async () => {
    const { seq } = await queueOne()
    const bundle = await buildTranslationBundle()

    expect(bundle.count).toBe(1)
    // Self-contained: pasted into a fresh session with none of this repo's context,
    // so the terminology has to travel with the request.
    expect(bundle.text).toContain('Required -> Wajib')
    expect(bundle.text).toContain('Common -> Lazim')
    expect(bundle.text).toContain('{genre}')
    expect(bundle.text).toContain('sung only by women at funerals')
    expect(bundle.text).toContain(String(seq))
    // The question must be marked as context, not as something to translate.
    expect(bundle.text).toMatch(/do NOT translate it/)
  })
})

describe('importing a Claude reply', () => {
  beforeEach(clearDb)

  it('applies a fenced JSON reply', async () => {
    const { ctx, seq } = await queueOne()
    const reply = `\`\`\`json\n[{"seq": ${seq}, "translation": "hanya dinyanyikan perempuan"}]\n\`\`\``

    const result = await importTranslationReply(reply)
    expect(result.applied).toBe(1)
    expect(entryTranslation(await findEntry(ctx, NODE, LAYER), 'id')).toBe(
      'hanya dinyanyikan perempuan',
    )
    expect(await pendingCount()).toBe(0)
  })

  it('survives a preamble the model was asked not to write', async () => {
    // Losing a finished batch to a stray "Here you go:" would be a bad trade for
    // strictness, so the parser is deliberately tolerant.
    const { ctx, seq } = await queueOne()
    const reply = `Sure! Here are the translations:\n\n[{"seq": ${seq}, "translation": "hanya perempuan"}]\n\nLet me know if you need changes.`

    expect((await importTranslationReply(reply)).applied).toBe(1)
    expect(entryTranslation(await findEntry(ctx, NODE, LAYER), 'id')).toBe('hanya perempuan')
  })

  it('ignores a reply that is not usable JSON', async () => {
    await queueOne()
    const result = await importTranslationReply('I could not translate these, sorry.')
    expect(result).toEqual({ applied: 0, stale: 0, missing: 0, unmatched: 0 })
    // The work stays queued rather than being silently consumed.
    expect(await pendingCount()).toBe(1)
  })

  it('skips blank translations instead of storing them', async () => {
    const { seq } = await queueOne()
    const result = await importTranslationReply(`[{"seq": ${seq}, "translation": "   "}]`)
    expect(result.applied).toBe(0)
    expect(await pendingCount()).toBe(1)
  })

  it('reports a reply entry that matches nothing queued', async () => {
    await queueOne()
    const result = await importTranslationReply('[{"seq": 999999, "translation": "apa pun"}]')
    expect(result.unmatched).toBe(1)
    expect(result.applied).toBe(0)
  })

  it('discards a translation of text the team edited while the batch was out', async () => {
    // The whole reason the queue stores source_text: an operator may take minutes
    // or hours over a batch, and the team keeps working meanwhile.
    const { ctx, seq } = await queueOne()
    await upsertEntry(ctx, NODE, LAYER, { text: 'actually sung by everyone' })

    const result = await importTranslationReply(`[{"seq": ${seq}, "translation": "hanya perempuan"}]`)
    expect(result.stale).toBe(1)
    expect(result.applied).toBe(0)
    expect((await findEntry(ctx, NODE, LAYER))?.translations).toBeUndefined()
  })

  it('applies a multi-item reply and counts each outcome', async () => {
    const ctx = await ensureActiveContext()
    const a = await upsertEntry(ctx, 's0.purpose.general', LAYER, { text: 'first answer' })
    const b = await upsertEntry(ctx, 's0.purpose.specific', LAYER, { text: 'second answer' })
    await enqueueTranslation({ text: 'first answer', targetLocale: 'id', entryId: a.id })
    await enqueueTranslation({ text: 'second answer', targetLocale: 'id', entryId: b.id })
    const rows = await pendingTranslations()

    const reply = JSON.stringify(rows.map((r, i) => ({ seq: r.seq, translation: `terjemahan ${i}` })))
    const result = await importTranslationReply(reply)
    expect(result.applied).toBe(2)
    expect(await pendingCount()).toBe(0)
  })
})

describe('abandoning a batch', () => {
  beforeEach(clearDb)

  it('stops offering work nobody is going to do', async () => {
    await queueOne()
    expect(await abandonPendingTranslations()).toBe(1)
    // One failed attempt is recorded, so it is still retryable but the operator
    // sees an honest queue.
    const rows = await db.translationQueue.toArray()
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].last_error).toContain('abandoned')
  })
})
