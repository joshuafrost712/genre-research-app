/**
 * The two translation engines behind the proxy, and what they have in common.
 *
 * Deliberately pure: every function here takes its credentials and endpoints as
 * arguments rather than reading `Deno.env`, so the request shaping and response
 * parsing are unit-testable from the app's own vitest suite. `index.ts` is the
 * only file that touches the environment.
 *
 * The two engines are not interchangeable, and the difference is worth stating
 * because it decides translation quality more than either one's price does:
 *
 *  - ANTHROPIC (Haiku 4.5) is instructed. It receives the worksheet question as
 *    context, is told the text is a fragmentary field note to translate rather
 *    than answer or tidy, and gets the glossary as terminology it should honour.
 *  - GOOGLE (Cloud Translation) is not. It receives text and a language pair. A
 *    glossary can be attached, but as exact-term substitution at decode time, and
 *    there is nowhere to put the question. A terse cell answer ("3 beats") is
 *    therefore translated blind.
 *
 * Google is the cheaper and faster of the two by a small margin on both counts.
 * Anthropic is the more accurate one on this workload. Keeping both selectable is
 * what lets that be measured on real answers instead of argued about.
 */

export type EngineName = 'anthropic' | 'google'

export interface EngineRequest {
  text: string
  /** Target language code; 'en' and 'id' are valid for both engines. */
  target: string
  /** Source language. Google auto-detects when absent; Anthropic ignores it. */
  source?: string
  /** The English worksheet question. Context for Anthropic; unusable by Google. */
  question?: string
}

export interface EngineResult {
  translation: string
  /** True when the engine returned the input unchanged (already in the target). */
  unchanged: boolean
  /** Engine-specific counters, surfaced for the pilot's cost and latency log. */
  usage?: Record<string, unknown> | null
}

/** A failure the proxy should report without leaking upstream error shapes. */
export class EngineError extends Error {
  constructor(
    message: string,
    /** Status to return to the browser: 429 passes through, everything else 502. */
    readonly status: number,
    /** Detail for the function log only, never for the response body. */
    readonly detail?: string,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

export interface AnthropicConfig {
  apiKey: string
  model: string
  maxTokens: number
  /** System prompt for the target language, from contract.generated.json. */
  system: string
  outputSchema: unknown
}

/**
 * The question is context the model may read, never content to translate, and it
 * is fenced so a question containing instructions cannot redirect the task.
 */
export function anthropicUserMessage(text: string, question?: string): string {
  return question
    ? [
        'Context — the worksheet question being answered (do NOT translate this, it is',
        'only here to disambiguate the answer):',
        question,
        '',
        'Translate this answer:',
        text,
      ].join('\n')
    : ['Translate this answer:', text].join('\n')
}

export async function translateWithAnthropic(
  req: EngineRequest,
  cfg: AnthropicConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<EngineResult> {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      system: cfg.system,
      output_config: { format: { type: 'json_schema', schema: cfg.outputSchema } },
      messages: [{ role: 'user', content: anthropicUserMessage(req.text, req.question) }],
    }),
  })

  if (!res.ok) {
    throw new EngineError(
      'translation service unavailable',
      res.status === 429 ? 429 : 502,
      `anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`,
    )
  }

  const payload = (await res.json()) as {
    content?: { type: string; text?: string }[]
    usage?: Record<string, unknown>
  }

  // Structured output guarantees the first text block is the JSON object.
  const raw = payload.content?.find((b) => b.type === 'text')?.text ?? ''
  let parsed: { translation?: string; unchanged?: boolean }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new EngineError(
      'translation service returned an unexpected shape',
      502,
      `unparseable model output: ${raw.slice(0, 300)}`,
    )
  }
  if (!parsed.translation?.trim()) throw new EngineError('empty translation', 502)

  return {
    translation: parsed.translation,
    unchanged: parsed.unchanged === true,
    usage: payload.usage ?? null,
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Translation
// ---------------------------------------------------------------------------

export interface GoogleConfig {
  /**
   * v2 (Basic): a plain API key. Five minutes to set up, no glossary possible.
   * Use this to get testing; move to v3 for terminology control.
   */
  apiKey?: string
  /** v3 (Advanced): an OAuth access token minted from a service account. */
  accessToken?: string
  projectId?: string
  /** Glossaries are regional, so v3 calls that use one share their location. */
  location?: string
  /** Full glossary resource name, or a bare id to be qualified with the above. */
  glossary?: string
}

/**
 * v2 returns HTML entities even with `format: 'text'`, which is a real defect
 * rather than a theoretical one: an Indonesian answer containing an apostrophe
 * comes back with `&#39;` in it, and that string would be saved into the team's
 * field verbatim. Only the five entities v2 actually emits are decoded, because a
 * general HTML unescape on translated field notes is a way to corrupt text that
 * legitimately contains an ampersand.
 */
export function decodeGoogleEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Qualify a bare glossary id into the resource name v3 expects. */
export function glossaryResourceName(cfg: GoogleConfig): string | undefined {
  if (!cfg.glossary) return undefined
  if (cfg.glossary.startsWith('projects/')) return cfg.glossary
  if (!cfg.projectId) return undefined
  return `projects/${cfg.projectId}/locations/${cfg.location ?? 'us-central1'}/glossaries/${cfg.glossary}`
}

export function googleV3Body(req: EngineRequest, cfg: GoogleConfig): Record<string, unknown> {
  const glossary = glossaryResourceName(cfg)
  return {
    contents: [req.text],
    mimeType: 'text/plain',
    targetLanguageCode: req.target,
    // A glossary requires an explicit source language; auto-detection is only
    // safe without one. Terse answers are exactly where detection guesses wrong,
    // which is the other reason the client now sends the source it already knows.
    ...(req.source ? { sourceLanguageCode: req.source } : {}),
    ...(glossary && req.source ? { glossaryConfig: { glossary, ignoreCase: true } } : {}),
  }
}

async function translateWithGoogleV3(
  req: EngineRequest,
  cfg: GoogleConfig,
  fetchImpl: typeof fetch,
): Promise<EngineResult> {
  const location = cfg.location ?? 'us-central1'
  const url = `https://translate.googleapis.com/v3/projects/${cfg.projectId}/locations/${location}:translateText`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.accessToken}`,
    },
    body: JSON.stringify(googleV3Body(req, cfg)),
  })

  if (!res.ok) {
    throw new EngineError(
      'translation service unavailable',
      res.status === 429 ? 429 : 502,
      `google v3 ${res.status}: ${(await res.text()).slice(0, 500)}`,
    )
  }

  const payload = (await res.json()) as {
    translations?: { translatedText?: string }[]
    glossaryTranslations?: { translatedText?: string }[]
  }
  // When a glossary is attached the terminology-corrected result arrives in a
  // SEPARATE array, and `translations` still holds the un-glossed one. Reading
  // the wrong field is a silent quality regression: everything works, and the
  // glossary simply has no effect.
  const out =
    payload.glossaryTranslations?.[0]?.translatedText ?? payload.translations?.[0]?.translatedText
  if (!out?.trim()) throw new EngineError('empty translation', 502)

  const translation = decodeGoogleEntities(out)
  return {
    translation,
    unchanged: translation.trim() === req.text.trim(),
    usage: { engine: 'google-v3', glossary: Boolean(glossaryResourceName(cfg) && req.source) },
  }
}

async function translateWithGoogleV2(
  req: EngineRequest,
  cfg: GoogleConfig,
  fetchImpl: typeof fetch,
): Promise<EngineResult> {
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(cfg.apiKey!)}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: req.text,
      target: req.target,
      format: 'text',
      ...(req.source ? { source: req.source } : {}),
    }),
  })

  if (!res.ok) {
    throw new EngineError(
      'translation service unavailable',
      res.status === 429 ? 429 : 502,
      `google v2 ${res.status}: ${(await res.text()).slice(0, 500)}`,
    )
  }

  const payload = (await res.json()) as {
    data?: { translations?: { translatedText?: string }[] }
  }
  const out = payload.data?.translations?.[0]?.translatedText
  if (!out?.trim()) throw new EngineError('empty translation', 502)

  const translation = decodeGoogleEntities(out)
  return {
    translation,
    unchanged: translation.trim() === req.text.trim(),
    usage: { engine: 'google-v2', glossary: false },
  }
}

/** v3 when a service-account token is available, else the v2 API-key path. */
export async function translateWithGoogle(
  req: EngineRequest,
  cfg: GoogleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<EngineResult> {
  if (cfg.accessToken && cfg.projectId) return translateWithGoogleV3(req, cfg, fetchImpl)
  if (cfg.apiKey) return translateWithGoogleV2(req, cfg, fetchImpl)
  throw new EngineError('translation is not configured', 503)
}
