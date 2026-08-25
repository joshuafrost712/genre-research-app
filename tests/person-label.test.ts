/**
 * Turning an email into a name to show in the overwrite toast.
 *
 * The server knows teammates by email and nothing else, so the local part of the
 * address is the only material there is. The line this file pins down is where
 * prettifying stops being a reading and starts being an invention: a guess that
 * reads as a confident name is worse than showing the address, because nobody
 * can tell it was a guess.
 */
import { describe, expect, it } from 'vitest'
import { personLabel } from '../src/lib/team/people'

describe('personLabel', () => {
  it('reads a separated local part as a name', () => {
    expect(personLabel('josh_frost@sil.org')).toBe('Josh Frost')
    expect(personLabel('rea.joy.lumawan@example.org')).toBe('Rea Joy Lumawan')
    expect(personLabel('ANGIE-SEOW@example.org')).toBe('Angie Seow')
  })

  it('shows the address when the local part is not a name', () => {
    // One word could be a first name, a handle or an abbreviation, and there is
    // no way to tell which from here.
    expect(personLabel('jfrost@sil.org')).toBe('jfrost@sil.org')
    // A digit run is an employee number or a disambiguator, never a name.
    expect(personLabel('josh.frost2@sil.org')).toBe('josh.frost2@sil.org')
    expect(personLabel('sil_1234@example.org')).toBe('sil_1234@example.org')
  })

  it('does not throw on input that is not an address', () => {
    expect(personLabel('')).toBe('')
    expect(personLabel('nobody')).toBe('nobody')
  })
})
