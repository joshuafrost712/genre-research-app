import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { ensureActiveContext } from '../src/lib/storage/appState'
import {
  addRow,
  findEntry,
  getRowIds,
  setBlockNotApplicable,
  setRowPriority,
  upsertEntry,
} from '../src/lib/storage/entries'
import { createCapturedNote, routeNoteToNode } from '../src/lib/storage/notes'
import { confirmEntry, discardProposal } from '../src/lib/storage/entries'
import { validatePlacement } from '../src/ai/contract'
import { importPlacementsText } from '../src/routing/operations'
import { computeProgress } from '../src/lib/progress'
import { buildAiPrompt, buildRows, buildSheetTabs, toCsv } from '../src/lib/export'
import { findNode } from '../src/lib/content/loader'

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

describe('Entry CRUD + container resolution', () => {
  beforeEach(clearDb)

  it('saves a scalar focus-text answer to the focus-text container', async () => {
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })
    const e = await findEntry(ctx, 's0.purpose.general', 'focusText')
    expect(e?.text).toBe('to encourage')
    expect(e?.focus_text_id).toBe(ctx.focusTextId)
    expect(e?.genre_id).toBeUndefined()
  })

  it('adds and removes repeatable rows, cascading cell deletes', async () => {
    const ctx = await ensureActiveContext()
    const rowId = await addRow(ctx, 's1b.inventory', 'genre')
    await upsertEntry(ctx, 's1b.inventory', 'genre', { text: 'Sung lament' }, `${rowId}__genreName`)
    expect(await getRowIds(ctx, 's1b.inventory', 'genre')).toEqual([rowId])

    const { removeRow } = await import('../src/lib/storage/entries')
    await removeRow(ctx, 's1b.inventory', 'genre', rowId)
    expect(await getRowIds(ctx, 's1b.inventory', 'genre')).toEqual([])
    const cell = await findEntry(ctx, 's1b.inventory', 'genre', `${rowId}__genreName`)
    expect(cell).toBeUndefined()
  })

  it('priority and not-applicable flags persist', async () => {
    const ctx = await ensureActiveContext()
    await setBlockNotApplicable(ctx, 's2a.how', 'genre', true)
    expect((await findEntry(ctx, 's2a.how', 'genre'))?.is_not_applicable).toBe(true)

    const rowId = await addRow(ctx, 's3a.features', 'genre')
    await setRowPriority(ctx, 's3a.features', 'genre', rowId, true)
    expect((await findEntry(ctx, 's3a.features', 'genre', rowId))?.is_priority).toBe(true)
  })
})

describe('Capture + routing', () => {
  beforeEach(clearDb)

  it('routes a note into a scalar field and records provenance', async () => {
    const ctx = await ensureActiveContext()
    const note = await createCapturedNote(ctx, 'Performed only at funerals')
    const node = findNode('s2a.how')!.node
    await routeNoteToNode(ctx, note, node)
    const e = await findEntry(ctx, 's2a.how', 'genre')
    expect(e?.text).toBe('Performed only at funerals')
    expect(e?.captured_note_id).toBe(note.id)
  })

  it('routes a note into a repeatable list as a new item', async () => {
    const ctx = await ensureActiveContext()
    const note = await createCapturedNote(ctx, 'Sung lament')
    const node = findNode('s1a.inventory')!.node
    await routeNoteToNode(ctx, note, node)
    const rows = await getRowIds(ctx, 's1a.inventory', 'focusText')
    expect(rows).toHaveLength(1)
    const item = await findEntry(ctx, 's1a.inventory', 'focusText', rows[0])
    expect(item?.text).toBe('Sung lament')
  })
})

describe('Progress + export', () => {
  beforeEach(clearDb)

  it('counts answered against the visible set and exports tidy rows', async () => {
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })
    await upsertEntry(ctx, 's0.purpose.broad_genre', 'focusText', { value: 'lament' })
    await setBlockNotApplicable(ctx, 's2a.how', 'genre', true)

    const entries = await db.entries.where('project_id').equals(ctx.projectId).toArray()

    const progress = computeProgress(entries, ctx, 'quick')
    expect(progress.overall.done).toBeGreaterThanOrEqual(3) // 2 answered + 1 N/A
    expect(progress.bySubsection['s0.purpose'].done).toBe(2)

    const names = { focusText: 'Psalm 13', genre: 'Sung lament', mode: 'quick' }
    const rows = buildRows(entries, names)
    // broad_genre select resolves to its label, not the raw id
    const genreRow = rows.find((r) => r.nodeId === 's0.purpose.broad_genre')
    expect(genreRow?.answer).toBe('Lament')
    // the N/A item appears as a recorded decision
    expect(rows.some((r) => r.nodeId === 's2a.how' && r.notApplicable === 'yes')).toBe(true)

    const csv = toCsv(rows)
    expect(csv.split('\n')[0]).toContain('Section,Subsection,Node ID')

    const prompt = buildAiPrompt(rows, names)
    expect(prompt).toContain('Focus text: Psalm 13')
    expect(prompt).toContain('NOT APPLICABLE')

    const tabs = buildSheetTabs(rows, names)
    // a tab per section present in the rows, with a header row
    expect(tabs.some((t) => t.title.startsWith('Section 0'))).toBe(true)
    const s0 = tabs.find((t) => t.title.startsWith('Section 0'))!
    expect(s0.values[2]).toContain('Answer') // header is the third row
    // sheet titles stay within Google's 31-char limit
    expect(tabs.every((t) => t.title.length <= 31)).toBe(true)
  })
})

describe('AI routing (GitHub / copy-paste, no API)', () => {
  beforeEach(clearDb)

  it('validates placements against known node ids', () => {
    const ids = new Set(['s2a.how'])
    expect(
      validatePlacement(
        { node_id: 's2a.how', text: 'x', confidence: 'high', needs_review: false, reason: 'r' },
        ids,
      ).ok,
    ).toBe(true)
    expect(
      validatePlacement({ node_id: 'nope', text: 'x', confidence: 'high', needs_review: false, reason: '' }, ids).ok,
    ).toBe(false)
    expect(
      validatePlacement({ node_id: 's2a.how', text: '', confidence: 'high', needs_review: true, reason: '' }, ids).ok,
    ).toBe(false)
  })

  it('imports Claude placements as needs_review, then confirms and discards', async () => {
    const ctx = await ensureActiveContext()
    const reply = JSON.stringify({
      results: [
        {
          schema: 'genre.placements/v1',
          note_id: 'n1',
          routed_at: 't',
          placements: [
            { node_id: 's2a.how', text: 'Highlights via refrain', confidence: 'high', needs_review: false, reason: 'prominence' },
            { node_id: 's1a.inventory', text: 'Sung lament', confidence: 'medium', needs_review: true, reason: 'a genre' },
            { node_id: 'not_a_node', text: 'x', confidence: 'low', needs_review: true, reason: 'bad' },
          ],
        },
      ],
    })
    const r = await importPlacementsText(reply, ctx)
    expect(r.stored).toBe(2)
    expect(r.rejected).toBe(1) // unknown node id

    const all = await db.entries.where('project_id').equals(ctx.projectId).toArray()
    const needs = all.filter((e) => e.routing_status === 'needs_review')
    expect(needs.length).toBe(2)

    const scalar = needs.find((e) => e.node_id === 's2a.how')!
    await confirmEntry(scalar.id)
    expect((await db.entries.get(scalar.id))!.routing_status).toBe('confirmed')

    const listItem = needs.find((e) => e.node_id === 's1a.inventory')!
    await discardProposal(listItem)
    expect(await db.entries.get(listItem.id)).toBeUndefined()
  })
})
