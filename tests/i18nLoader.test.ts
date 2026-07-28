import { describe, expect, it } from 'vitest'
import { findNode, findSourceNode, navTree, journey } from '../src/lib/content/loader'
import { setActiveLocale } from '../src/lib/i18n/activeLocale'
import { catalogueSize } from '../src/lib/i18n/content'
import glossary from '../src/content/glossary/id.json'

/**
 * Integration test against the REAL shipped Indonesian catalogue, as opposed to
 * i18nContent.test.ts which uses a fixture to exercise the fallback machinery.
 * This one answers: does switching locale actually change what the app renders?
 */

const INTERPOLATION_TOKENS = ['{genre}', '{passage}']

describe('the shipped Indonesian catalogue', () => {
  it('is populated', () => {
    expect(catalogueSize('id')).toBeGreaterThan(200)
  })

  it('translates every string the extractor found', () => {
    // Mirrors `npm run i18n:report -- id` as a build-time guard, so a newly added
    // English string cannot ship silently untranslated.
    setActiveLocale('en')
    const untranslated: string[] = []
    const walk = (id: string) => {
      const en = findSourceNode(id)?.node
      const idn = findNode(id)?.node
      if (!en || !idn) return
      if (en.label && en.label === idn.label && !/^[\d\s\W]+$/.test(en.label)) {
        untranslated.push(`${id}.label`)
      }
      for (const c of en.children ?? []) walk(c.id)
    }
    setActiveLocale('id')
    for (const { section } of navTree()) walk(section.id)
    expect(untranslated).toEqual([])
  })
})

describe('locale switching through the loader', () => {
  it('returns Indonesian for the active locale and English from the source hatch', () => {
    setActiveLocale('id')
    expect(findNode('s1a')?.node.label).toBe('1a: Menemukan Genre Lokal')
    // The source hatch ignores the active locale — this is what keeps
    // edit-in-place working (its endpoint compares oldText against English).
    expect(findSourceNode('s1a')?.node.label).toBe('1a: Find Local Genres')

    setActiveLocale('en')
    expect(findNode('s1a')?.node.label).toBe('1a: Find Local Genres')
  })

  it('localises derived journey and workspace titles', () => {
    setActiveLocale('id')
    const describe = journey().find((s) => s.id === 'find')
    expect(describe?.title).toBe('1a: Menemukan Genre Lokal')
    setActiveLocale('en')
    expect(journey().find((s) => s.id === 'find')?.title).toBe('1a: Find Local Genres')
  })

  it('localises nested blocks, options, and table columns', () => {
    setActiveLocale('id')
    const vitality = findNode('s1b.vitality')?.node
    expect(vitality?.options?.map((o) => o.label)).toEqual([
      'Punah',
      'Terkunci',
      'Meredup',
      'Mantap',
      'Berkembang',
    ])
    // Option ids are the stored value and must never be translated.
    expect(vitality?.options?.map((o) => o.id)).toEqual([
      'extinct',
      'locked',
      'fading',
      'stable',
      'thriving',
    ])
    setActiveLocale('en')
  })

  it('renders the Required/Common marking identically everywhere it appears', () => {
    // The same English help text appears on six style pages. Divergent wording
    // would teach teams two different definitions of the app's core distinction.
    setActiveLocale('id')
    const helps = ['s3a', 's3b', 's3c', 's3d', 's3e', 's3f'].map(
      (s) => findNode(`${s}.features`)?.node.columns?.find((c) => c.id === 'modality')?.help,
    )
    expect(helps.every((h) => h && h === helps[0])).toBe(true)
    expect(helps[0]).toContain('Wajib')
    expect(helps[0]).toContain('Lazim')
    setActiveLocale('en')
  })
})

describe('interpolation tokens survive translation', () => {
  it('keeps every {genre} and {passage} the English had', () => {
    // A dropped token renders a sentence with a hole in it. 70 of the 269 strings
    // carry one, so this is the highest-frequency way a translation can break.
    const offenders: string[] = []
    const check = (id: string) => {
      setActiveLocale('en')
      const en = findSourceNode(id)?.node
      setActiveLocale('id')
      const idn = findNode(id)?.node
      if (!en || !idn) return
      for (const field of ['label', 'guidance', 'footnote', 'help', 'example'] as const) {
        const src = en[field]
        const out = idn[field]
        if (!src || !out) continue
        for (const tok of INTERPOLATION_TOKENS) {
          if (src.includes(tok) && !out.includes(tok)) offenders.push(`${id}.${field} lost ${tok}`)
        }
      }
      for (const c of en.children ?? []) check(c.id)
    }
    setActiveLocale('en')
    const roots = navTree().map((n) => n.section.id)
    for (const r of roots) check(r)
    setActiveLocale('en')
    expect(offenders).toEqual([])
  })
})

describe('glossary', () => {
  it('never lets an interpolation token be translated', () => {
    for (const tok of INTERPOLATION_TOKENS) {
      expect(glossary.doNotTranslate).toContain(tok)
    }
  })

  it('has a target term for every entry', () => {
    const bad = glossary.terms.filter((t) => !t.en?.trim() || !t.id?.trim())
    expect(bad).toEqual([])
  })

  it('has no duplicate source terms, which would make the guidance ambiguous', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const t of glossary.terms) {
      if (seen.has(t.en)) dupes.push(t.en)
      seen.add(t.en)
    }
    expect(dupes).toEqual([])
  })

  it('pins the app-critical Required/Common distinction', () => {
    const byEn = new Map(glossary.terms.map((t) => [t.en, t.id]))
    expect(byEn.get('Required')).toBe('Wajib')
    expect(byEn.get('Common')).toBe('Lazim')
  })
})
