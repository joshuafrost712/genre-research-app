/**
 * Self-serve account creation. The two things worth pinning down are that a
 * mistyped confirmation never reaches the network, and that the Edge Function's own
 * wording survives all the way to the person reading it — a signup that fails with
 * "Could not create the account" when the real cause was a wrong invite code is a
 * support ticket rather than a fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('../src/lib/supabase/client', () => ({
  supabase: {},
  isSupabaseConfigured: () => true,
}))

// MIN_PASSWORD_LENGTH moved into session.ts when the reset flow started enforcing
// it too, so the mock has to carry it: without the real value, every length check
// in signup.ts silently compares against undefined and passes.
vi.mock('../src/lib/supabase/session', () => ({
  signInWithPassword: mocks.signInWithPassword,
  MIN_PASSWORD_LENGTH: 8,
}))

import { createAccount } from '../src/lib/supabase/signup'

const GOOD = {
  name: 'Ada Lovelace',
  email: 'Ada@Example.ORG',
  password: 'analytical-engine',
  confirm: 'analytical-engine',
  code: 'four-random-words-here',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('createAccount', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co')
    vi.stubEnv('VITE_SIGNUP_URL', '')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    mocks.signInWithPassword.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('catches a mismatched confirmation without calling the server', async () => {
    const res = await createAccount({ ...GOOD, confirm: 'analytical-engin' })
    expect(res).toEqual({ ok: false, error: 'The two passwords do not match.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('catches a short password without calling the server', async () => {
    const res = await createAccount({ ...GOOD, password: 'short', confirm: 'short' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/at least 8/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires the invite code before calling the server', async () => {
    const res = await createAccount({ ...GOOD, code: '   ' })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/invite code/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the function’s wording when the invite code is wrong', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: 'That invite code is not right. Check the email it came in.' }),
    )
    const res = await createAccount(GOOD)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('That invite code is not right. Check the email it came in.')
    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
  })

  it('surfaces the already-registered message rather than a generic failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'There is already an account for that email. Sign in instead.' }),
    )
    const res = await createAccount(GOOD)
    expect(res.error).toMatch(/already an account/i)
  })

  it('falls back to a readable message when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    const res = await createAccount(GOOD)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Could not create the account. Try again shortly.')
  })

  it('reports a reachability problem rather than throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await createAccount(GOOD)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/connection/i)
  })

  it('posts a normalised payload and signs in on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, email: 'ada@example.org' }))
    const res = await createAccount({ ...GOOD, name: '  Ada Lovelace  ' })
    expect(res.ok).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://test-project.supabase.co/functions/v1/signup')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.org',
      password: 'analytical-engine',
      code: 'four-random-words-here',
    })

    // Signed in with the credentials just chosen, so nobody faces a second form.
    expect(mocks.signInWithPassword).toHaveBeenCalledWith('ada@example.org', 'analytical-engine')
  })
})
