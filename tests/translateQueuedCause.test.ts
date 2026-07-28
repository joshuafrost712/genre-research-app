import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the app tells someone whose translation was deferred.
 *
 * This is a message-correctness test, not a plumbing one. The failure it guards
 * is a sentence that sends a facilitator hunting for a control that is not on
 * their screen: the proxy identifies callers by Supabase account, and the only
 * Supabase sign-in in the app is the beta-tester header control, so "sign in
 * (top right)" is true on the tester link and false on the plain URL.
 */
vi.mock('../src/devfeedback/enabled', () => ({ isBetaMode: vi.fn(() => false) }))
vi.mock('../src/lib/supabase/client', () => ({
  supabase: null,
  isSupabaseConfigured: vi.fn(() => false),
}))

const { isBetaMode } = await import('../src/devfeedback/enabled')
const { isSupabaseConfigured } = await import('../src/lib/supabase/client')
const { queuedCauseForStatus } = await import('../src/lib/translate/client')

function onTesterLink(yes: boolean) {
  vi.mocked(isBetaMode).mockReturnValue(yes)
  vi.mocked(isSupabaseConfigured).mockReturnValue(yes)
}

describe('why a translation was deferred', () => {
  beforeEach(() => onTesterLink(false))

  it('offers sign-in only where a sign-in control exists', () => {
    onTesterLink(true)
    expect(queuedCauseForStatus(401)).toBe('signed-out')
  })

  it('points at the tester link when the view has no sign-in at all', () => {
    expect(queuedCauseForStatus(401)).toBe('needs-tester-link')
    expect(queuedCauseForStatus(403)).toBe('needs-tester-link')
  })

  it('separates "not switched on" from "you are not signed in"', () => {
    // 503 is the function reporting it has no model key. Collapsing this into the
    // sign-in message would send a tester to sign in and change nothing.
    expect(queuedCauseForStatus(503)).toBe('not-configured')
  })

  it('names rate limiting, which passes on its own', () => {
    expect(queuedCauseForStatus(429)).toBe('busy')
  })

  it('says nothing specific about a status it does not recognise', () => {
    // Better a bare "Queued." than a confident wrong diagnosis.
    expect(queuedCauseForStatus(500)).toBe('unknown')
    expect(queuedCauseForStatus(502)).toBe('unknown')
  })
})
