import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { ensureActiveContext } from '../src/lib/storage/appState'
import { findEntry, upsertEntry, upsertEntryWithHistory } from '../src/lib/storage/entries'
import { macroDecisions } from '../src/lib/content/sectionRecall'
import {
  needsSummary,
  purposeCoverage,
  requiredFeatureRefs,
  summaryCell,
} from '../src/lib/content/summarize'
import type { Entry } from '../src/lib/types'

function entry(p: Partial<Entry>): Entry {
  return {
    id: Math.random().toString(36).slice(2),
    project_id: 'p1',
    node_id: '',
    text: '',
    routing_status: 'confirmed',
    schema_version: 'test',
    sync_status: 'local',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...p,
  } as Entry
}

describe('summary nudge + table cells', () => {
  it('flags long answers by word or character count', () => {
    expect(needsSummary('short answer')).toBe(false)
    expect(needsSummary('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen')).toBe(true)
    expect(needsSummary('x'.repeat(121))).toBe(true)
    expect(needsSummary('   ')).toBe(false)
  })

  it('prefers the one-line summary, truncates long answers otherwise', () => {
    const long = 'a very long conversational answer about who takes part in the genre '.repeat(4)
    const withSummary = [
      entry({ node_id: 's2eth.who', genre_id: 'g1', text: long }),
      entry({ node_id: 's2eth.who', genre_id: 'g1', cell_key: '__summary', text: 'Women lead, all join' }),
    ]
    expect(summaryCell(withSummary, 'g1', 's2eth.who')).toEqual({
      text: 'Women lead, all join',
      missingSummary: false,
    })
    const withoutSummary = [entry({ node_id: 's2eth.who', genre_id: 'g1', text: long })]
    const cell = summaryCell(withoutSummary, 'g1', 's2eth.who')
    expect(cell.missingSummary).toBe(true)
    expect(cell.text.endsWith('…')).toBe(true)
  })
})

describe('purpose coverage (many-to-many)', () => {
  it('counts one genre under several families and flags empty families', () => {
    const entries = [
      entry({ node_id: 's1b.purpose_families', genre_id: 'g1', value: JSON.stringify(['lament', 'praise']) }),
      entry({ node_id: 's1b.purpose_families', genre_id: 'g2', value: JSON.stringify(['praise']) }),
    ]
    const genres = [
      { id: 'g1', name: 'Rap' },
      { id: 'g2', name: 'Hymn' },
    ]
    const cov = purposeCoverage(entries, genres)
    expect(cov.find((f) => f.id === 'lament')?.genreNames).toEqual(['Rap'])
    expect(cov.find((f) => f.id === 'praise')?.genreNames).toEqual(['Rap', 'Hymn'])
    expect(cov.find((f) => f.id === 'wisdom')?.genreNames).toEqual([])
  })
})

describe('required features (2d source)', () => {
  it('collects only required-marked rows, with their area', () => {
    const entries = [
      entry({ node_id: 's3c.features', genre_id: 'g1', cell_key: '__rows', value: JSON.stringify(['r1', 'r2']) }),
      entry({ node_id: 's3c.features', genre_id: 'g1', cell_key: 'r1__feature', text: 'end rhyme on every line' }),
      entry({ node_id: 's3c.features', genre_id: 'g1', cell_key: 'r1__modality', value: 'required' }),
      entry({ node_id: 's3c.features', genre_id: 'g1', cell_key: 'r2__feature', text: 'la-la vocables' }),
      entry({ node_id: 's3c.features', genre_id: 'g1', cell_key: 'r2__modality', value: 'common' }),
    ]
    const refs = requiredFeatureRefs(entries, 'g1')
    expect(refs).toHaveLength(1)
    expect(refs[0].text).toBe('end rhyme on every line')
    expect(refs[0].tableId).toBe('s3c.features')
    expect(refs[0].areaLabel.toLowerCase()).toContain('sounds')
  })
})

describe('macro decisions (2e recap)', () => {
  it('collects idea-column cells from fixed grids and repeatable tables', () => {
    const entries = [
      // prominence is a fixed grid: rows have static labels
      entry({
        node_id: 's0.macro_notes.prominence',
        worksheet_id: 'w1',
        cell_key: 'primary__translation_idea',
        text: 'refrain carries the main line',
      }),
      // emotions is repeatable: headline from the first column
      entry({ node_id: 's0.macro_notes.emotions', worksheet_id: 'w1', cell_key: '__rows', value: JSON.stringify(['e1']) }),
      entry({ node_id: 's0.macro_notes.emotions', worksheet_id: 'w1', cell_key: 'e1__emotion', text: 'grief (v1-2)' }),
      entry({ node_id: 's0.macro_notes.emotions', worksheet_id: 'w1', cell_key: 'e1__genre_elements', text: 'slow drum, low voice' }),
    ]
    const groups = macroDecisions(entries, 'w1')
    const prominence = groups.find((g) => g.group.toLowerCase().includes('stands out'))
    expect(prominence?.fields[0]).toEqual({
      label: 'Most important',
      value: 'refrain carries the main line',
    })
    const emotions = groups.find((g) => g.group.toLowerCase().includes('feel'))
    expect(emotions?.fields[0]).toEqual({ label: 'grief (v1-2)', value: 'slow drum, low voice' })
  })
})

describe('version history (recover lost information)', () => {
  beforeEach(async () => {
    await Promise.all([db.entries.clear(), db.history.clear(), db.meta.clear(), db.projects.clear(), db.focusTexts.clear(), db.genres.clear(), db.worksheets.clear()])
  })

  it('records the prior value on change and supports restore', async () => {
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 's2b.organization', 'genre', { text: 'call, verses, blessing' })
    // First history-recording edit stores the old value.
    await upsertEntryWithHistory(ctx, 's2b.organization', 'genre', { text: 'verses only' })
    const rows = await db.history.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].prev_text).toBe('call, verses, blessing')
    expect(rows[0].node_id).toBe('s2b.organization')

    // Restoring writes back the old value and records the replaced one too.
    await upsertEntryWithHistory(
      ctx,
      's2b.organization',
      'genre',
      { text: rows[0].prev_text ?? '' },
      undefined,
      'restore',
    )
    const e = await findEntry(ctx, 's2b.organization', 'genre')
    expect(e?.text).toBe('call, verses, blessing')
    expect(await db.history.count()).toBe(2)
  })

  it('does not record history for unchanged or first writes', async () => {
    const ctx = await ensureActiveContext()
    await upsertEntryWithHistory(ctx, 's2b.music', 'genre', { text: 'one tune per line' })
    await upsertEntryWithHistory(ctx, 's2b.music', 'genre', { text: 'one tune per line' })
    expect(await db.history.count()).toBe(0)
  })
})
