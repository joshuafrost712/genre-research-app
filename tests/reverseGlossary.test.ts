import { describe, expect, it, vi } from 'vitest'

/**
 * The into-English direction of the glossary, on a fixture rather than the real
 * one.
 *
 * The real glossary happens to have no two English terms sharing an Indonesian
 * rendering, so its 101 terms reverse cleanly and the collision-dropping branch
 * never runs against it. A reviewer adding one synonym would silently exercise
 * untested code, so the fixture forces the case.
 */
vi.mock('../src/content/glossary/id.json', () => ({
  default: {
    doNotTranslate: ['{genre}', 'YWAM', 'Alkitab'],
    notes: [],
    terms: [
      { en: 'passage', id: 'perikop' },
      { en: 'Scripture', id: 'Alkitab' },
      // A deliberate collision: two English terms, one Indonesian rendering.
      { en: 'performance', id: 'penyajian' },
      { en: 'presentation', id: 'penyajian' },
      // Casing and padding, to check the key is normalised but display is not.
      { en: 'stanza', id: '  Bait  ' },
    ],
  },
}))

const { buildSystemPrompt, reverseGlossaryIntoEnglish } = await import('../src/lib/translate/prompt')

describe('reversing the glossary for the into-English direction', () => {
  it('reverses an unambiguous pair', () => {
    expect(reverseGlossaryIntoEnglish()).toContainEqual({ id: 'perikop', en: 'passage' })
  })

  it('drops a term two English words share', () => {
    // Picking one of "performance" / "presentation" arbitrarily would be worse
    // than letting the model read the context, so the pair is omitted entirely.
    const pairs = reverseGlossaryIntoEnglish()
    expect(pairs.find((p) => p.id === 'penyajian')).toBeUndefined()
    expect(pairs.some((p) => p.en === 'performance')).toBe(false)
  })

  it('trims the Indonesian term without mangling its casing', () => {
    expect(reverseGlossaryIntoEnglish()).toContainEqual({ id: 'Bait', en: 'stanza' })
  })

  it('never emits the same Indonesian term twice', () => {
    const ids = reverseGlossaryIntoEnglish().map((p) => p.id)
    expect(ids.length).toBe(new Set(ids).size)
  })
})

describe('the into-English system prompt', () => {
  const prompt = buildSystemPrompt('en')

  it('asks for English and carries the reversed terminology', () => {
    expect(prompt).toContain('into English')
    expect(prompt).toContain('perikop -> passage')
  })

  it('does not both protect a term and ask for it to be translated', () => {
    // The bug this guards: doNotTranslate was authored for the outbound
    // direction, so reusing it verbatim told the model to leave `Alkitab` alone
    // and to render it as `Scripture` in the same breath.
    const protectedSection = prompt.split('character for character:')[1]?.split('\n\n')[0] ?? ''
    expect(protectedSection).not.toContain('Alkitab')
    expect(prompt).toContain('Alkitab -> Scripture')
  })

  it('still protects the language-neutral items', () => {
    expect(prompt).toContain('{genre}')
    expect(prompt).toContain('YWAM')
  })
})
