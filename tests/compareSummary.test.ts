import { describe, expect, it } from 'vitest'
import {
  psalmIdentity,
  genreLinking,
  genreWords,
} from '../src/lib/content/compareSummary'
import type { Entry } from '../src/lib/types'

/** Minimal Entry factory: the summary helpers only read a few fields. */
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

describe('compareSummary', () => {
  it('resolves the psalm broad-genre select to its label and drops empty fields', () => {
    const entries = [
      entry({ node_id: 's0.purpose.specific', focus_text_id: 'f1', text: 'A cry for rescue' }),
      entry({ node_id: 's0.purpose.broad_genre', focus_text_id: 'f1', value: 'lament' }),
      // general is empty -> should not appear
      entry({ node_id: 's0.purpose.general', focus_text_id: 'f1', text: '   ' }),
    ]
    const fields = psalmIdentity(entries, 'f1')
    expect(fields.find((f) => f.label === 'What it is mainly about')?.value).toBe('A cry for rescue')
    expect(fields.find((f) => f.label === 'Kind of passage')?.value).toMatch(/^Lament/)
    expect(fields.find((f) => f.label === 'What it is mainly doing')).toBeUndefined()
  })

  it('ignores answers from a different focus text', () => {
    const entries = [
      entry({ node_id: 's0.purpose.specific', focus_text_id: 'other', text: 'Not mine' }),
    ]
    expect(psalmIdentity(entries, 'f1')).toHaveLength(0)
  })

  it('groups the 2E grid by row with short column labels', () => {
    const entries = [
      entry({ node_id: 's2d.chart', genre_id: 'g1', cell_key: 'words__sounds', text: 'matching tune' }),
      entry({ node_id: 's2d.chart', genre_id: 'g1', cell_key: 'words__structural', text: 'same beats' }),
      // a different genre's cell must be excluded
      entry({ node_id: 's2d.chart', genre_id: 'g2', cell_key: 'words__sounds', text: 'other genre' }),
    ]
    const fields = genreLinking(entries, 'g1')
    expect(fields).toHaveLength(1)
    expect(fields[0].label).toBe('Related words')
    expect(fields[0].value).toContain('Sounds — matching tune')
    expect(fields[0].value).toContain('same beats')
    expect(fields[0].value).not.toContain('other genre')
  })

  it('lists word features in row order with the how-fixed (Required/Common) label', () => {
    const entries = [
      entry({ node_id: 's3a.expected', genre_id: 'g1', text: 'opening call' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: '__rows', value: JSON.stringify(['r1', 'r2']) }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r1__feature', text: 'first feature' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r2__feature', text: 'second feature' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r2__modality', value: 'required' }),
    ]
    const fields = genreWords(entries, 'g1')
    expect(fields[0].value).toBe('opening call')
    // Feature rows follow their stored order (the star/priority feature was removed);
    // the "how fixed" Required/Common label still rides along.
    const featureFields = fields.filter((f) => f.label === 'Feature')
    expect(featureFields).toHaveLength(2)
    expect(featureFields[0].value).toBe('first feature')
    expect(featureFields[1].value).toContain('second feature')
    expect(featureFields[1].value).toContain('how fixed:')
    expect(featureFields[1].value).toContain('Required')
  })
})
