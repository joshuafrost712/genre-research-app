import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { ensureActiveContext } from '../src/lib/storage/appState'
import { addRow, setRowPriority, setBlockNotApplicable, upsertEntry } from '../src/lib/storage/entries'
import { buildRows, type ExportNames } from '../src/lib/export'
import { buildReportModel } from '../src/lib/report/model'
import { buildDocx } from '../src/lib/report/docx'

const names: ExportNames = { focusText: 'Psalm 13', genre: 'Sung lament', mode: 'quick' }
const meta = { date: '2026-07-09' }

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.capturedNotes.clear(),
    db.entries.clear(),
    db.persons.clear(),
    db.meta.clear(),
  ])
}

describe('buildReportModel', () => {
  beforeEach(clearDb)

  it('groups answers into sections/subsections/questions with a title block', async () => {
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })
    const entries = await db.entries.where('project_id').equals(ctx.projectId).toArray()

    const model = buildReportModel(buildRows(entries, names), names, meta)
    expect(model.focusText).toBe('Psalm 13')
    expect(model.genre).toBe('Sung lament')
    expect(model.date).toBe('2026-07-09')
    expect(model.answeredCount).toBe(1)
    expect(model.sections.length).toBeGreaterThan(0)

    const q = model.sections
      .flatMap((s) => s.subsections)
      .flatMap((sub) => sub.questions)
      .find((qq) => qq.nodeId === 's0.purpose.general')
    expect(q?.cells[0]?.answer).toBe('to encourage')
    expect(q?.isGrid).toBe(false)
  })

  it('rolls up priorities and marks not-applicable questions', async () => {
    const ctx = await ensureActiveContext()
    await setBlockNotApplicable(ctx, 's2a.how', 'genre', true)
    const rowId = await addRow(ctx, 's3a.features', 'genre')
    await upsertEntry(ctx, 's3a.features', 'genre', { text: 'Refrain repetition' }, `${rowId}__featureName`)
    await setRowPriority(ctx, 's3a.features', 'genre', rowId, true)

    const entries = await db.entries.where('project_id').equals(ctx.projectId).toArray()
    const model = buildReportModel(buildRows(entries, names), names, meta)

    expect(model.priorities.some((p) => p.answer === 'Refrain repetition')).toBe(true)

    const na = model.sections
      .flatMap((s) => s.subsections)
      .flatMap((sub) => sub.questions)
      .find((qq) => qq.nodeId === 's2a.how')
    expect(na?.cells.some((c) => c.notApplicable)).toBe(true)
  })

  it('shapes a grid question with columns and rows', async () => {
    const ctx = await ensureActiveContext()
    const rowId = await addRow(ctx, 's0.genre_choice.candidates', 'synthesis')
    await upsertEntry(ctx, 's0.genre_choice.candidates', 'synthesis', { text: 'Sung lament' }, `${rowId}__name`)

    const entries = await db.entries.where('project_id').equals(ctx.projectId).toArray()
    const model = buildReportModel(buildRows(entries, names), names, meta)

    const grid = model.sections
      .flatMap((s) => s.subsections)
      .flatMap((sub) => sub.questions)
      .find((qq) => qq.nodeId === 's0.genre_choice.candidates')
    expect(grid?.isGrid).toBe(true)
    expect(grid?.cells.length).toBeGreaterThan(0)
    expect(grid?.columns.length).toBeGreaterThan(0) // column display labels, not ids
  })

  it('renders a non-empty .docx blob from the model', async () => {
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })
    const entries = await db.entries.where('project_id').equals(ctx.projectId).toArray()
    const model = buildReportModel(buildRows(entries, names), names, meta)

    const blob = await buildDocx(model)
    expect(blob.size).toBeGreaterThan(1000) // a real zipped .docx, not an empty stub
  })
})