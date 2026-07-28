import { describe, expect, it, vi } from 'vitest'

/**
 * Turning the curated glossary into a Google glossary file, on a fixture.
 *
 * The real glossary reverses cleanly, so its collision branches never run against
 * it — the same reason `reverseGlossary.test.ts` uses a fixture. Here the stakes
 * are higher than in the prompt path: a Google glossary is applied as exact
 * substitution with no model to notice that a term is being asserted as equivalent
 * in both directions when it is only safe in one.
 */
vi.mock('../src/content/glossary/id.json', () => ({
  default: {
    doNotTranslate: ['{genre}', 'OBT', 'Alkitab'],
    notes: [],
    terms: [
      { en: 'passage', id: 'perikop' },
      { en: 'Scripture', id: 'Alkitab' },
      // Two English terms, one Indonesian rendering.
      { en: 'performance', id: 'penyajian' },
      { en: 'presentation', id: 'penyajian' },
      // One English term, two renderings: the same defect mirrored.
      { en: 'chant', id: 'kidung' },
      { en: 'chant', id: 'nyanyian' },
      { en: 'stanza', id: '  Bait  ' },
      { en: 'call & response', id: 'panggil, jawab' },
    ],
  },
}))

const { bidirectionalTerms, protectedTerms, buildGoogleGlossaryCsv, csvField } = await import(
  '../src/lib/translate/glossaryExport'
)

describe('which terms are safe to assert as equivalents', () => {
  it('keeps an unambiguous pair', () => {
    expect(bidirectionalTerms()).toContainEqual({ en: 'passage', id: 'perikop' })
  })

  it('drops a rendering two English terms share', () => {
    const ids = bidirectionalTerms().map((r) => r.id)
    expect(ids).not.toContain('penyajian')
  })

  it('drops an English term with two renderings, not just the reverse case', () => {
    // Enforcing uniqueness on one side only would leave the forward direction
    // claiming two different renderings for `chant`.
    expect(bidirectionalTerms().some((r) => r.en === 'chant')).toBe(false)
  })

  it('trims without mangling casing', () => {
    expect(bidirectionalTerms()).toContainEqual({ en: 'stanza', id: 'Bait' })
  })
})

describe('protected terms', () => {
  it('maps a term to itself so substitution leaves it alone', () => {
    expect(protectedTerms()).toContainEqual({ en: 'OBT', id: 'OBT' })
    expect(protectedTerms()).toContainEqual({ en: '{genre}', id: '{genre}' })
  })

  it('does not both protect a term and ask for it to be translated', () => {
    // `Alkitab` is on the do-not-translate list and is also the rendering of
    // `Scripture`. A glossary containing both instructions is a contradiction that
    // resolves unpredictably, so the protective copy is dropped.
    expect(protectedTerms().some((r) => r.en === 'Alkitab')).toBe(false)
    expect(bidirectionalTerms()).toContainEqual({ en: 'Scripture', id: 'Alkitab' })
  })
})

describe('the CSV', () => {
  it('leads with the language-code header an equivalent term set needs', () => {
    // Without this row Google reads the file as unidirectional and the first term
    // pair is silently consumed as the header.
    expect(buildGoogleGlossaryCsv().split('\n')[0]).toBe('en,id')
  })

  it('quotes a term containing a comma instead of splitting it into two columns', () => {
    expect(csvField('panggil, jawab')).toBe('"panggil, jawab"')
    expect(csvField('plain')).toBe('plain')
    expect(csvField('say "this"')).toBe('"say ""this"""')
    expect(buildGoogleGlossaryCsv()).toContain('call & response,"panggil, jawab"')
  })

  it('emits one row per surviving term and nothing else', () => {
    const rows = buildGoogleGlossaryCsv().trim().split('\n').slice(1)
    expect(rows).toHaveLength(bidirectionalTerms().length + protectedTerms().length)
  })
})
