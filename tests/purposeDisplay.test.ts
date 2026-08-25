import { describe, expect, it } from 'vitest'
import { purposeDisplay, summaryCell } from '../src/lib/content/summarize'
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

// The shapes 2b must handle, from a real field-team report (2026-08). Their
// work and war songs fit none of the purpose-family chips, so the purpose
// lives in the 1b free-text fields, and the substance lives in the "usually
// about" field that 1f shows by default. 2b must show all three sources, or
// it either denies a recorded purpose or contradicts the 1f table.
describe('purposeDisplay', () => {
  it('chips ticked: chips, the "say more" note, and the content all show', () => {
    const entries = [
      entry({ node_id: 's1b.purpose_families', genre_id: 'g1', value: '["lament"]' }),
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: 'sung to mourn someone who has died' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'about loss and remembering' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual(['lament'])
    expect(d.purposeText).toBe('sung to mourn someone who has died')
    expect(d.aboutText).toBe('about loss and remembering')
  })

  it('a supplementary "also used to…" note never replaces the content answer', () => {
    // The 1b prompt is "Say MORE about the purposes", so its answers are
    // additions. Showing it alone dropped "feasting" from the row while 1f
    // still showed it.
    const entries = [
      entry({ node_id: 's1b.purpose_families', genre_id: 'g1', value: '["entertaining"]' }),
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: 'also used to settle a restless child' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'feasting, cradle song' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.aboutText).toBe('feasting, cradle song')
    expect(d.purposeText).toBe('also used to settle a restless child')
  })

  it('no chips: the free text and the content both still carry the row', () => {
    const entries = [
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: 'sung before a hunt\nthe melody can carry new words' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'a song that goes with a hunting dance' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual([])
    expect(d.purposeText).toContain('sung before a hunt')
    expect(d.aboutText).toBe('a song that goes with a hunting dance')
  })

  it('no purpose fields at all: "usually about" alone keeps the row honest', () => {
    const entries = [entry({ node_id: 's1b.content', genre_id: 'g1', text: 'keeps the rhythm going during shared work' })]
    const d = purposeDisplay(entries, 'g1')
    expect(d.familyIds).toEqual([])
    expect(d.purposeText).toBe('')
    expect(d.aboutText).toBe('keeps the rhythm going during shared work')
  })

  it('a cleared purposes answer counts as empty', () => {
    const entries = [
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: '' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'sung while building the meeting house' }),
    ]
    const d = purposeDisplay(entries, 'g1')
    expect(d.purposeText).toBe('')
    expect(d.aboutText).toBe('sung while building the meeting house')
  })

  it('shows the same text as the 1f table for the same genre', () => {
    // 1f's default column is s1b.content, summary-cell shortened. 2b must not
    // disagree with it.
    const entries = [
      entry({ node_id: 's1b.content', genre_id: 'g1', text: 'played at the harvest feast, after dark, teasing each other in veiled words, at the turn of the year' }),
      entry({ node_id: 's1b.content', genre_id: 'g1', cell_key: '__summary', text: 'feasting, cradle song' }),
      entry({ node_id: 's1b.purposes', genre_id: 'g1', text: 'also used to settle a restless child' }),
    ]
    expect(purposeDisplay(entries, 'g1').aboutText).toBe(
      summaryCell(entries, 'g1', 's1b.content').text,
    )
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
