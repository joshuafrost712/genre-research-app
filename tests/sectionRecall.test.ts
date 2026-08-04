import { describe, expect, it } from 'vitest'
import { deriveSectionRecall, translationSummary } from '../src/lib/content/sectionRecall'
import type { Entry } from '../src/lib/types'

/** Minimal Entry factory: the recall helpers only read a few fields. */
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

describe('deriveSectionRecall', () => {
  it('surfaces a section 3 subsection for the active genre, in row order', () => {
    const entries = [
      entry({ node_id: 's3a.expected', genre_id: 'g1', text: 'opening call' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: '__rows', value: JSON.stringify(['r1', 'r2']) }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r1__feature', text: 'first feature' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r2__feature', text: 'second feature' }),
      // a different genre's work must not leak in
      entry({ node_id: 's3a.expected', genre_id: 'g2', text: 'other genre' }),
    ]
    const fields = deriveSectionRecall(entries, 's3a', 'g1')
    const values = fields.map((f) => f.value)
    expect(values).toContain('opening call')
    expect(values).not.toContain('other genre')
    // Table rows follow their stored order (the star/priority feature was removed).
    const rowFields = fields.filter((f) => f.value === 'first feature' || f.value === 'second feature')
    expect(rowFields.map((f) => f.value)).toEqual(['first feature', 'second feature'])
  })

  it('returns nothing when the source subsection is empty for the genre', () => {
    expect(deriveSectionRecall([], 's3a', 'g1')).toHaveLength(0)
  })

  it('surfaces fixed_grid charts (1d.4 connections) row by row', () => {
    // s2d's content lives entirely in s2d.chart, a fixed_grid; the /macro rail
    // showed nothing for it before the fixed_grid case existed (2026-07-24 #3).
    const entries = [
      entry({ node_id: 's2d.chart', genre_id: 'g1', cell_key: 'words__sounds', text: 'echoed refrain' }),
      entry({ node_id: 's2d.chart', genre_id: 'g1', cell_key: 'phrases__structural', text: 'matched line pairs' }),
      entry({ node_id: 's2d.chart', genre_id: 'g2', cell_key: 'words__sounds', text: 'other genre' }),
    ]
    const fields = deriveSectionRecall(entries, 's2d', 'g1')
    expect(fields).toHaveLength(2)
    expect(fields[0].label).toBe('Related words')
    expect(fields[0].value).toContain('echoed refrain')
    expect(fields[1].label).toBe('Related phrases')
    expect(fields[1].value).toContain('matched line pairs')
    expect(fields.map((f) => f.value).join(' ')).not.toContain('other genre')
  })
})

describe('translationSummary', () => {
  it('gathers purpose and the chosen genre', () => {
    const entries = [
      entry({ node_id: 's0.purpose.specific', focus_text_id: 'f1', text: 'A cry for rescue' }),
      entry({ node_id: 's0.purpose.broad_genre', focus_text_id: 'f1', value: 'lament' }),
      entry({ node_id: 's0.genre_choice.chosen', worksheet_id: 'w1', text: 'Sung lament' }),
    ]
    const s = translationSummary(entries, 'f1', 'w1')
    expect(s.chosenGenre).toBe('Sung lament')
    expect(s.purpose.find((f) => f.label === 'What it is about')?.value).toBe('A cry for rescue')
  })
})
