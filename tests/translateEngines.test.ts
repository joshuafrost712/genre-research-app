import { describe, expect, it, vi } from 'vitest'
import {
  anthropicUserMessage,
  decodeGoogleEntities,
  glossaryResourceName,
  googleV3Body,
  translateWithGoogle,
  EngineError,
} from '../supabase/functions/translate/engines'

/**
 * The two engines behind the proxy, tested from the app's suite.
 *
 * The Edge Function runs on Deno and normally cannot be reached from here, which
 * is why `engines.ts` takes its credentials as arguments and never reads
 * `Deno.env`: the request shaping and response parsing are the parts most likely
 * to be silently wrong, and they are now ordinary functions.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('the Google request', () => {
  it('names the source language, and attaches the glossary only then', () => {
    // A glossary requires an explicit source language. Sending the glossary with
    // an auto-detected source is rejected by the API, so the two travel together.
    const cfg = { projectId: 'p', location: 'us-central1', glossary: 'g' }
    const withSource = googleV3Body({ text: 'x', target: 'id', source: 'en' }, cfg)
    expect(withSource.sourceLanguageCode).toBe('en')
    expect(withSource.glossaryConfig).toEqual({
      glossary: 'projects/p/locations/us-central1/glossaries/g',
      ignoreCase: true,
    })

    const withoutSource = googleV3Body({ text: 'x', target: 'id' }, cfg)
    expect(withoutSource.sourceLanguageCode).toBeUndefined()
    expect(withoutSource.glossaryConfig).toBeUndefined()
  })

  it('accepts a full resource name unchanged and qualifies a bare id', () => {
    expect(glossaryResourceName({ glossary: 'projects/a/locations/b/glossaries/c' })).toBe(
      'projects/a/locations/b/glossaries/c',
    )
    expect(glossaryResourceName({ glossary: 'c', projectId: 'a', location: 'b' })).toBe(
      'projects/a/locations/b/glossaries/c',
    )
    // No project means no resource name can be formed; better absent than wrong.
    expect(glossaryResourceName({ glossary: 'c' })).toBeUndefined()
    expect(glossaryResourceName({ projectId: 'a' })).toBeUndefined()
  })
})

describe('the Google response', () => {
  it('prefers the glossary-corrected translation over the plain one', async () => {
    // THE quiet failure this guards. With a glossary attached, the corrected text
    // arrives in `glossaryTranslations` and `translations` still holds the
    // un-glossed version. Reading the wrong field leaves everything working and
    // the glossary with no effect at all — no error, no log, just worse terms.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        translations: [{ translatedText: 'pertunjukan' }],
        glossaryTranslations: [{ translatedText: 'penyajian' }],
      }),
    )
    const out = await translateWithGoogle(
      { text: 'performance', target: 'id', source: 'en' },
      { accessToken: 't', projectId: 'p', glossary: 'g' },
      fetchImpl as unknown as typeof fetch,
    )
    expect(out.translation).toBe('penyajian')
    expect(out.usage).toMatchObject({ glossary: true })
  })

  it('falls back to the plain translation when no glossary is in play', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ translations: [{ translatedText: 'perikop' }] }),
    )
    const out = await translateWithGoogle(
      { text: 'passage', target: 'id', source: 'en' },
      { accessToken: 't', projectId: 'p' },
      fetchImpl as unknown as typeof fetch,
    )
    expect(out.translation).toBe('perikop')
  })

  it('decodes the entities v2 emits even in text mode', async () => {
    // Not theoretical: an answer with an apostrophe comes back containing `&#39;`
    // and that string would be saved into the team's field verbatim.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: { translations: [{ translatedText: 'the elder&#39;s song' }] } }),
    )
    const out = await translateWithGoogle(
      { text: 'lagu tetua', target: 'en', source: 'id' },
      { apiKey: 'k' },
      fetchImpl as unknown as typeof fetch,
    )
    expect(out.translation).toBe("the elder's song")
  })

  it('leaves a legitimate ampersand alone', () => {
    // A general HTML unescape would corrupt field notes; only what v2 emits is
    // decoded, and an already-plain ampersand must survive untouched.
    expect(decodeGoogleEntities('call & response')).toBe('call & response')
    expect(decodeGoogleEntities('&amp;')).toBe('&')
  })

  it('reports text returned unchanged rather than pretending it was translated', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ translations: [{ translatedText: 'mahzani' }] }),
    )
    const out = await translateWithGoogle(
      { text: 'mahzani', target: 'en', source: 'id' },
      { accessToken: 't', projectId: 'p' },
      fetchImpl as unknown as typeof fetch,
    )
    expect(out.unchanged).toBe(true)
  })
})

describe('engine failures', () => {
  it('passes a rate limit through and collapses everything else', async () => {
    const status = async (code: number) => {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, code))
      try {
        await translateWithGoogle(
          { text: 'x', target: 'id', source: 'en' },
          { accessToken: 't', projectId: 'p' },
          fetchImpl as unknown as typeof fetch,
        )
        return 0
      } catch (err) {
        return (err as EngineError).status
      }
    }
    // 429 has to survive so the client can back off; a 500 must not leak upstream
    // error shapes to the browser.
    expect(await status(429)).toBe(429)
    expect(await status(500)).toBe(502)
    expect(await status(403)).toBe(502)
  })

  it('refuses to run with no credentials at all', async () => {
    await expect(
      translateWithGoogle({ text: 'x', target: 'id' }, {}),
    ).rejects.toMatchObject({ status: 503 })
  })

  it('treats an empty translation as a failure, not as an empty answer', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ translations: [{ translatedText: '  ' }] }))
    await expect(
      translateWithGoogle(
        { text: 'x', target: 'id', source: 'en' },
        { accessToken: 't', projectId: 'p' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 502 })
  })
})

describe('the Anthropic message', () => {
  it('fences the question so it cannot redirect the task', () => {
    const msg = anthropicUserMessage('hanya perempuan', 'Who takes part in {genre}?')
    expect(msg).toMatch(/do NOT translate this/)
    expect(msg).toContain('Who takes part in {genre}?')
  })

  it('omits the context block when there is no question', () => {
    expect(anthropicUserMessage('hanya perempuan')).not.toMatch(/Context/)
  })
})
