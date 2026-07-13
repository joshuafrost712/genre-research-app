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
  it('surfaces a section 3 subsection for the active genre, starred rows first', () => {
    const entries = [
      entry({ node_id: 's3a.expected', genre_id: 'g1', text: 'opening call' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: '__rows', value: JSON.stringify(['r1', 'r2']) }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r1__feature', text: 'plain feature' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r2__feature', text: 'key feature' }),
      entry({ node_id: 's3a.features', genre_id: 'g1', cell_key: 'r2', is_priority: true }),
      // a different genre's work must not leak in
      entry({ node_id: 's3a.expected', genre_id: 'g2', text: 'other genre' }),
    ]
    const fields = deriveSectionRecall(entries, 's3a', 'g1')
    const values = fields.map((f) => f.value)
    expect(values).toContain('opening call')
    expect(values).not.toContain('other genre')
    // Among the table rows, the starred one is marked and sorted first.
    const rowFields = fields.filter((f) => f.value === 'key feature' || f.value === 'plain feature')
    expect(rowFields[0].value).toBe('key feature')
    expect(rowFields[0].starred).toBe(true)
  })

  it('returns nothing when the source subsection is empty for the genre', () => {
    expect(deriveSectionRecall([], 's3a', 'g1')).toHaveLength(0)
  })
})

describe('translationSummary', () => {
  it('gathers purpose, chosen genre, and starred stylistic priorities', () => {
    const entries = [
      entry({ node_id: 's0.purpose.specific', focus_text_id: 'f1', text: 'A cry for rescue' }),
      entry({ node_id: 's0.purpose.broad_genre', focus_text_id: 'f1', value: 'lament' }),
      entry({ node_id: 's0.genre_choice.chosen', worksheet_id: 'w1', text: 'Sung lament' }),
      entry({ node_id: 's0.sn.words', worksheet_id: 'w1', cell_key: '__rows', value: JSON.stringify(['a', 'b']) }),
      entry({ node_id: 's0.sn.words', worksheet_id: 'w1', cell_key: 'a__feature', text: 'refrain' }),
      entry({ node_id: 's0.sn.words', worksheet_id: 'w1', cell_key: 'a__idea', text: 'keep the refrain' }),
      entry({ node_id: 's0.sn.words', worksheet_id: 'w1', cell_key: 'a', is_priority: true }),
      // an unstarred row is not a priority
      entry({ node_id: 's0.sn.words', worksheet_id: 'w1', cell_key: 'b__feature', text: 'not starred' }),
    ]
    const s = translationSummary(entries, 'f1', 'w1')
    expect(s.chosenGenre).toBe('Sung lament')
    expect(s.purpose.find((f) => f.label === 'What it is about')?.value).toBe('A cry for rescue')
    expect(s.priorities).toHaveLength(1)
    expect(s.priorities[0].value).toContain('refrain')
    expect(s.priorities[0].value).toContain('keep the refrain')
  })
})
