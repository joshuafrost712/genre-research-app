import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { testContext } from './helpers/context'
import {
  entryTranslation,
  findEntry,
  saveEntryTranslation,
  upsertEntry,
  upsertEntryWithHistory,
} from '../src/lib/storage/entries'
import { setActiveLocale } from '../src/lib/i18n/activeLocale'

const NODE = 's0.purpose.general'
const LAYER = 'focusText' as const

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.entries.clear(),
    db.history.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

describe('answer translations', () => {
  beforeEach(async () => {
    await clearDb()
    setActiveLocale('en')
  })

  it('records the language the answer was typed in', async () => {
    setActiveLocale('id')
    const ctx = await testContext()
    await upsertEntry(ctx, NODE, LAYER, { text: 'untuk menguatkan' })
    expect((await findEntry(ctx, NODE, LAYER))?.source_language).toBe('id')
  })

  it('stores and reads a translation per locale', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    const saved = await findEntry(ctx, NODE, LAYER)
    expect(entryTranslation(saved, 'id')).toBe('untuk menguatkan')
    expect(entryTranslation(saved, 'tl')).toBeUndefined()
  })

  it('merges locales instead of evicting each other', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    await saveEntryTranslation(e.id, 'tl', 'upang magpalakas')
    const saved = await findEntry(ctx, NODE, LAYER)
    expect(entryTranslation(saved, 'id')).toBe('untuk menguatkan')
    expect(entryTranslation(saved, 'tl')).toBe('upang magpalakas')
  })

  it('treats an emptied translation as a removal, not an empty string', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    await saveEntryTranslation(e.id, 'id', '   ')
    expect(entryTranslation(await findEntry(ctx, NODE, LAYER), 'id')).toBeUndefined()
  })

  // The headline correctness rule. A translation describes a specific answer; if
  // the team rewrites the answer, keeping the old translation would show a
  // reviewer text the team never said.
  describe('stale invalidation', () => {
    it('clears translations when the answer text changes', async () => {
      const ctx = await testContext()
      const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
      await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')

      await upsertEntry(ctx, NODE, LAYER, { text: 'to comfort the grieving' })

      const after = await findEntry(ctx, NODE, LAYER)
      expect(after?.text).toBe('to comfort the grieving')
      expect(after?.translations).toBeUndefined()
    })

    it('clears translations on the history-tracking write path too', async () => {
      const ctx = await testContext()
      const e = await upsertEntryWithHistory(ctx, NODE, LAYER, { text: 'to encourage' })
      await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')

      await upsertEntryWithHistory(ctx, NODE, LAYER, { text: 'to lament' })

      expect((await findEntry(ctx, NODE, LAYER))?.translations).toBeUndefined()
    })

    it('clears translations when a select value changes', async () => {
      const ctx = await testContext()
      const e = await upsertEntry(ctx, NODE, LAYER, { text: 'praise', value: 'praise' })
      await saveEntryTranslation(e.id, 'id', 'pujian')

      await upsertEntry(ctx, NODE, LAYER, { value: 'lament' })

      expect((await findEntry(ctx, NODE, LAYER))?.translations).toBeUndefined()
    })

    it('KEEPS translations when the answer is unchanged', async () => {
      // Re-saving identical text happens constantly: AutosaveText flushes on blur
      // after a debounce already fired. Dropping the translation there would make
      // translations vanish for no reason the user can see.
      const ctx = await testContext()
      const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
      await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')

      await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })

      expect(entryTranslation(await findEntry(ctx, NODE, LAYER), 'id')).toBe('untuk menguatkan')
    })

    it('KEEPS translations when an unrelated field changes', async () => {
      const ctx = await testContext()
      const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
      await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')

      await upsertEntry(ctx, NODE, LAYER, { is_concern_flag: true })

      const after = await findEntry(ctx, NODE, LAYER)
      expect(after?.is_concern_flag).toBe(true)
      expect(entryTranslation(after, 'id')).toBe('untuk menguatkan')
    })

    it('lets a translation write itself through without self-clearing', async () => {
      const ctx = await testContext()
      await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
      // A patch carrying both new text and its translation (the deferred lane
      // writing back a batch) must not have the translation stripped.
      await upsertEntry(ctx, NODE, LAYER, {
        text: 'to comfort',
        translations: { id: 'untuk menghibur' },
      })
      expect(entryTranslation(await findEntry(ctx, NODE, LAYER), 'id')).toBe('untuk menghibur')
    })
  })

  it('queues the change for sync so a translation reaches other devices', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await db.outbox.clear()
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    expect(await db.outbox.count()).toBeGreaterThan(0)
  })
})
