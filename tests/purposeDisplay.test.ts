import { describe, expect, it } from 'vitest'
import { purposeDisplay } from '../src/lib/content/summarize'
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

// The four shapes 2b must handle, from a real field-team report (2026-08):
// their work and war songs fit none of the purpose-family chips, so the
// purpose lives in the 1b free-text fields instead, and 2b was headlining
// those genres as "No purposes recorded yet".
describe('purposeDisplay', () => {
  it('chips ticked: chips headline, free text rides along, no fallback', () => {
    const entries = [
      entry({ node_id: 's1b.purpose_families', genre_id: 'g1', value: '["lament"]' }),
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: 'sung to mourn someone who has died' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'about loss and remembering' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual(['lament'])
    expect(d.purposeText).toBe('sung to mourn someone who has died')
    expect(d.aboutText).toBe('')
  })

  it('no chips but free-text purposes: the text carries the row, no fallback', () => {
    const entries = [
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: 'sung before a hunt\nthe melody can carry new words' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'a song that goes with a hunting dance' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual([])
    expect(d.purposeText).toContain('sung before a hunt')
    expect(d.aboutText).toBe('')
  })

  it('no purpose fields at all: "usually about" stands in', () => {
    const entries = [entry({ node_id: 's1b.content', genre_id: 'g1', text: 'keeps the rhythm going during shared work' })]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual([])
    expect(d.purposeText).toBe('')
    expect(d.aboutText).toBe('keeps the rhythm going during shared work')
  })

  it('a cleared purposes answer counts as empty and still falls back', () => {
    const entries = [
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: '' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'sung while building the meeting house' }),
    ]
    expect(purposeDisplay(entries, 'g1').aboutText).toBe('sung while building the meeting house')
  })

  it('nothing anywhere: everything empty (2b keeps its "add them in 1b" nudge)', () => {
    const d = purposeDisplay([], 'g1')
    expect(d).toEqual({ familyIds: [], purposeText: '', aboutText: '' })
  })

  it('reads only the asked-for genre and ignores table cells', () => {
    const entries = [
      entry({ node_id: 's1b.purposes', genre_id: 'other', text: 'someone else’s purpose' }),
      entry({ node_id: 's1b.purpose_families', genre_id: 'g1', cell_key: 'r1__x', value: '["wisdom"]' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual([])
    expect(d.purposeText).toBe('')
  })

  it('prefers the one-line summary cell over a long purposes answer', () => {
    const long = 'used for teaching and advice: singers write their own words after a speech so the community remembers what was said'
    const entries = [
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: long }),
      entry({ node_id: 's1b.purposes', genre_id: 'g1', cell_key: '__summary', text: 'teaching, advice, testimony' }),
    ]
    expect(purposeDisplay(entries, 'g1').purposeText).toBe('teaching, advice, testimony')
  })
})
