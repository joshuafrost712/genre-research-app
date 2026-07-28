import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { answerLocale, translationTargetFor } from '../src/lib/translate/direction'
import { preferredText } from '../src/lib/storage/entries'
import { missingChromeKeys, t } from '../src/lib/i18n/strings'

describe('which language an answer is translated into', () => {
  it('gives the reader the language they are reading in', () => {
    // A team typed English; a reviewer is reading the app in Indonesian.
    expect(translationTargetFor('en', 'id')).toBe('id')
  })

  it('translates an Indonesian answer into English for a consultant', () => {
    // THE case the first cut got wrong. Everything was translated into Indonesian,
    // so a team working in Indonesian produced nothing a non-Indonesian-reading
    // consultant could review, and the field hid itself rather than admit it.
    expect(translationTargetFor('id', 'en')).toBe('en')
  })

  it('offers the other language when reader and answer already agree', () => {
    // Both directions, so one toggle is enough: whatever language you are working
    // in, the field offers the one you are not.
    expect(translationTargetFor('en', 'en')).toBe('id')
    expect(translationTargetFor('id', 'id')).toBe('en')
  })

  it('treats an answer with no recorded language as English', () => {
    // Entries written before source_language existed. Assuming English matches
    // what the app actually was at the time.
    expect(translationTargetFor(undefined, 'id')).toBe('id')
    expect(translationTargetFor(null, 'en')).toBe('id')
  })

  it('treats a language this build does not support as English', () => {
    // A synced record could name a locale added by a newer build. Falling back
    // beats throwing the row away or rendering an empty target.
    expect(answerLocale('tl')).toBe('en')
    expect(answerLocale('')).toBe('en')
    expect(translationTargetFor('tl', 'id')).toBe('id')
  })

  it('never proposes translating text into its own language', () => {
    for (const source of ['en', 'id', undefined, 'zz']) {
      for (const ui of ['en', 'id'] as const) {
        const target = translationTargetFor(source, ui)
        expect(target).not.toBe(answerLocale(source))
      }
    }
  })
})

describe('read-only previews', () => {
  const entry = {
    text: 'hanya dinyanyikan perempuan',
    translations: { en: 'sung only by women' },
  } as unknown as Parameters<typeof preferredText>[0]

  it('shows the translation to a reader of that language', () => {
    expect(preferredText(entry, 'en')).toBe('sung only by women')
  })

  it('falls back to the original rather than showing an empty row', () => {
    expect(preferredText(entry, 'id')).toBe('hanya dinyanyikan perempuan')
    expect(preferredText({ text: 'x' } as never, 'en')).toBe('x')
  })

  it('ignores a blank translation', () => {
    // A whitespace-only translation is not a translation; treating it as one would
    // blank a row that has perfectly good text in it.
    expect(preferredText({ text: 'asli', translations: { en: '   ' } } as never, 'en')).toBe('asli')
  })

  it('is empty for a missing entry rather than throwing', () => {
    expect(preferredText(null, 'en')).toBe('')
    expect(preferredText(undefined, 'id')).toBe('')
  })
})

describe('chrome strings', () => {
  it('substitutes a value into a placeholder', () => {
    expect(t('en', 'translate.offer', { language: 'Bahasa Indonesia' })).toBe(
      'Translate this answer into Bahasa Indonesia.',
    )
    expect(t('id', 'nav.workspace', { n: 2 })).toBe('Ruang Kerja 2')
  })

  it('leaves an unsupplied placeholder visible rather than blanking it', () => {
    // A hole in a sentence is invisible in review; a literal {language} is not.
    expect(t('en', 'translate.offer')).toContain('{language}')
  })

  it('falls back to English for a locale with no entry', () => {
    expect(t('id', 'translate.action')).toBe('Terjemahkan')
  })

  it('has every chrome string translated into Indonesian', () => {
    // The guard that keeps the navigation from silently drifting back to English
    // as new UI is added: a new key without an `id` fails here.
    expect(missingChromeKeys('id')).toEqual([])
  })
})
