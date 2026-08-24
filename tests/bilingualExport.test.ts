import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { testContext } from './helpers/context'
import { saveEntryTranslation, upsertEntry } from '../src/lib/storage/entries'
import { buildRows, toCsv, type ExportNames } from '../src/lib/export'
import { buildReportModel } from '../src/lib/report/model'
import { setActiveLocale } from '../src/lib/i18n/activeLocale'

const NAMES: ExportNames = { focusText: 'Psalm 13', genre: 'Ohuokai', mode: 'standard' }
const NODE = 's0.purpose.general'
const LAYER = 'focusText' as const

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.entries.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

describe('bilingual export', () => {
  beforeEach(async () => {
    await clearDb()
    setActiveLocale('en')
  })

  it('leaves a monolingual export exactly as it was', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    const entries = await db.entries.toArray()

    const rows = buildRows(entries, NAMES)
    expect(rows[0].questionAlt).toBeUndefined()
    expect(rows[0].answerAlt).toBeUndefined()
    // No bilingual columns in the header, so existing consumers are unaffected.
    const csv = toCsv(rows)
    expect(csv).not.toContain('other language')
  })

  it('pairs the question in both languages', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    const entries = await db.entries.toArray()

    setActiveLocale('id')
    const rows = buildRows(entries, NAMES, { altLocale: 'en' })
    const row = rows.find((r) => r.nodeId === NODE)!
    // Primary column follows the active locale; the pair carries English.
    expect(row.question).toBe('Apa yang terutama sedang dilakukan perikop itu? (Misalnya: mengajar, menguatkan, atau berduka.)')
    expect(row.questionAlt).toBe(
      'What is the passage mainly doing? (For example: teaching, encouraging, or mourning.)',
    )
    setActiveLocale('en')
  })

  it("keeps the team's own words as the answer and the translation as the pair", async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    const entries = await db.entries.toArray()

    const rows = buildRows(entries, NAMES, { altLocale: 'id' })
    const row = rows.find((r) => r.nodeId === NODE)!
    // The record of what the team said must never be replaced by a machine
    // translation of it.
    expect(row.answer).toBe('to encourage')
    expect(row.answerAlt).toBe('untuk menguatkan')
  })

  it('emits bilingual CSV columns beside the ones they pair with', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    const entries = await db.entries.toArray()

    const csv = toCsv(buildRows(entries, NAMES, { altLocale: 'id' }))
    const header = csv.split('\n')[0]
    expect(header).toContain('Question,Question (other language),Answer,Answer (other language)')
    expect(csv).toContain('untuk menguatkan')
  })

  it('leaves answerAlt empty when an answer has no translation yet', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    const entries = await db.entries.toArray()

    const rows = buildRows(entries, NAMES, { altLocale: 'id' })
    const row = rows.find((r) => r.nodeId === NODE)!
    expect(row.answerAlt).toBeUndefined()
    // An untranslated answer must render as an empty cell, never "undefined".
    expect(toCsv(rows)).not.toContain('undefined')
  })

  it('carries the pair through to the report model the Word and PDF renderers share', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'to encourage' })
    await saveEntryTranslation(e.id, 'id', 'untuk menguatkan')
    const entries = await db.entries.toArray()

    const model = buildReportModel(buildRows(entries, NAMES, { altLocale: 'id' }), NAMES, {
      date: '2026-07-28',
    })
    const question = model.sections
      .flatMap((s) => s.subsections)
      .flatMap((s) => s.questions)
      .find((q) => q.nodeId === NODE)!
    expect(question.questionAlt).toBeTruthy()
    expect(question.cells[0].answerAlt).toBe('untuk menguatkan')
  })
})
