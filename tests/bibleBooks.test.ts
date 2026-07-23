import { describe, it, expect } from 'vitest'
import {
  canonicalIndex,
  formatReference,
  parseReference,
  passageMatchesQuery,
  resolveBook,
} from '../src/lib/bibleBooks'

describe('bibleBooks — reference parsing', () => {
  it('parses a plain book + chapter', () => {
    expect(parseReference('Psalm 13')).toEqual({ book: 'Psalms', chapter: 13 })
  })

  it('parses abbreviations and chapter:verse ranges', () => {
    expect(parseReference('Ps 13:1-2')).toEqual({
      book: 'Psalms',
      chapter: 13,
      verse_start: 1,
      verse_end: 2,
    })
    expect(parseReference('1 Cor 13:4-7')).toEqual({
      book: '1 Corinthians',
      chapter: 13,
      verse_start: 4,
      verse_end: 7,
    })
  })

  it('handles a numbered book written in full and an en-dash range', () => {
    expect(parseReference('2 Samuel 12:1–7')).toEqual({
      book: '2 Samuel',
      chapter: 12,
      verse_start: 1,
      verse_end: 7,
    })
  })

  it('defaults verse_end to verse_start for a single verse', () => {
    expect(parseReference('John 3:16')).toEqual({
      book: 'John',
      chapter: 3,
      verse_start: 16,
      verse_end: 16,
    })
  })

  it('returns empty for an unresolvable reference and never throws', () => {
    expect(parseReference('some field notes')).toEqual({})
    expect(parseReference('')).toEqual({})
  })

  it('normalizes to the canonical book name when composing', () => {
    // "Psalm" (alias) resolves to the canonical "Psalms".
    expect(formatReference(parseReference('Psalm 13:1-2'))).toBe('Psalms 13:1-2')
    expect(formatReference({ book: 'Psalms', chapter: 13 })).toBe('Psalms 13')
    expect(formatReference({})).toBe('')
  })
})

describe('bibleBooks — canonical order & search', () => {
  it('orders books canonically, unknown last', () => {
    expect(canonicalIndex('Genesis')).toBe(0)
    expect(canonicalIndex('Revelation')).toBe(65)
    expect(canonicalIndex('Psalms')).toBeLessThan(canonicalIndex('Matthew'))
    expect(canonicalIndex(undefined)).toBe(Number.MAX_SAFE_INTEGER)
    expect(canonicalIndex('Nonsense')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('resolves aliases to canonical names', () => {
    expect(resolveBook('ps')).toBe('Psalms')
    expect(resolveBook('1 cor')).toBe('1 Corinthians')
    expect(resolveBook('Ps.')).toBe('Psalms')
    expect(resolveBook('nope')).toBeUndefined()
  })

  it('matches passages by reference text and book alias', () => {
    expect(passageMatchesQuery('Psalm 13', 'Psalms', 'psalm')).toBe(true)
    expect(passageMatchesQuery('Psalm 13', 'Psalms', 'ps')).toBe(true)
    expect(passageMatchesQuery('Psalm 13', 'Psalms', 'john')).toBe(false)
    expect(passageMatchesQuery('Psalm 13', 'Psalms', '')).toBe(true)
  })
})
