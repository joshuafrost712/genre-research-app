/**
 * Translation proxy (Lane A, the interactive path).
 *
 * Holds the engine credentials server-side and translates one field at a time
 * fast enough for a team to sit and wait: the client's budget is under two
 * seconds.
 *
 * Deployed with `./scripts/enable-translation.sh` (Anthropic) or
 * `node scripts/setup-google-translation.mjs` (Google). Either sets the secrets
 * this file reads and then proves the result with a probe that costs nothing.
 *
 * Design decisions worth knowing before changing this:
 *
 * 1. The client cannot supply a prompt. It sends structured fields only (text,
 *    source and target locale, and the question being answered). The Anthropic
 *    prompt comes from contract.generated.json, produced from
 *    src/lib/translate/prompt.ts by `npm run i18n:contract`. If the client could
 *    send a prompt, any beta login would be arbitrary model access on the key.
 * 2. A Supabase JWT is required. The app already signs beta testers in, so this
 *    reuses an identity that exists rather than inventing a shared secret, and it
 *    gives a per-user handle for rate limiting.
 * 3. Structured output is mandatory on the Anthropic path, so a preamble can never
 *    be written into a team's answer field.
 * 4. TRANSLATE_ENGINE picks the engine, and an unconfigured engine is a 503 that
 *    names the missing secret rather than a silent fall back to the other one. A
 *    proxy that quietly changes engine is a proxy whose output quality cannot be
 *    reasoned about, and comparing the two engines on real answers is the whole
 *    reason both exist.
 */
import contract from './contract.generated.json' with { type: 'json' }
import {
  EngineError,
  translateWithAnthropic,
  translateWithGoogle,
  type EngineName,
  type EngineRequest,
  type EngineResult,
} from './engines.ts'
import { googleAccessToken, parseServiceAccount } from './googleAuth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

const ENGINE: EngineName = Deno.env.get('TRANSLATE_ENGINE') === 'anthropic' ? 'anthropic' : 'google'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_TRANSLATE_API_KEY')
const GOOGLE_SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID')
const GOOGLE_LOCATION = Deno.env.get('GOOGLE_LOCATION') ?? 'us-central1'
const GOOGLE_GLOSSARY = Deno.env.get('GOOGLE_GLOSSARY')

/** Longest answer we will translate. Well above a long paragraph; blocks abuse. */
const MAX_INPUT_CHARS = 6000

/** Per-user throttle. */
const RATE_LIMIT_PER_MINUTE = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Whether the selected engine has what it needs, and if not, which secret is
 * missing. Returned to the browser because a tester seeing "queued" deserves a
 * cause, and none of these strings reveal anything a secret protects.
 */
function engineReadiness(): string | null {
  if (ENGINE === 'anthropic') {
    return ANTHROPIC_KEY ? null : 'set ANTHROPIC_API_KEY'
  }
  if (GOOGLE_SA_JSON && !GOOGLE_PROJECT_ID) return 'set GOOGLE_PROJECT_ID'
  if (!GOOGLE_SA_JSON && !GOOGLE_API_KEY) {
    return 'set GOOGLE_SERVICE_ACCOUNT_JSON (v3, glossary) or GOOGLE_TRANSLATE_API_KEY (v2)'
  }
  return null
}

/**
 * In-memory sliding window, per warm isolate.
 *
 * LIMITATION, deliberately accepted: Supabase may run several isolates, so the
 * effective ceiling is this multiplied by the isolate count, and it resets on cold
 * start. It is a guard against a runaway client loop, not a billing control. The
 * real spend ceiling is the provider account's own limit, and for this workload
 * (5 teams, a pilot measured in single-digit dollars) that is the right place for
 * it. Move to a Postgres counter if this ever fronts untrusted users.
 */
const hits = new Map<string, number[]>()

function rateLimited(userId: string): boolean {
  const now = Date.now()
  const cutoff = now - 60_000
  const recent = (hits.get(userId) ?? []).filter((t) => t > cutoff)
  recent.push(now)
  hits.set(userId, recent)
  // Bound the map so a long-lived isolate cannot grow it without limit.
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k)
  }
  return recent.length > RATE_LIMIT_PER_MINUTE
}

/** Resolve the caller from their Supabase JWT. Returns null when not signed in. */
async function resolveUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ') || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
    })
    if (!res.ok) return null
    const user = (await res.json()) as { id?: string }
    return user.id ?? null
  } catch {
    return null
  }
}

async function runEngine(req: EngineRequest): Promise<EngineResult> {
  if (ENGINE === 'anthropic') {
    const system = (contract.systemPrompts as Record<string, string>)[req.target]
    if (!system) throw new EngineError(`no translation contract for locale ${req.target}`, 400)
    return await translateWithAnthropic(req, {
      apiKey: ANTHROPIC_KEY!,
      model: contract.model,
      maxTokens: contract.maxTokens,
      system,
      outputSchema: contract.outputSchema,
    })
  }

  // Google v3 needs an OAuth token; v2 needs only the API key. Minting happens
  // here rather than inside the engine so the engine stays pure and testable.
  let accessToken: string | undefined
  if (GOOGLE_SA_JSON) {
    try {
      accessToken = await googleAccessToken(parseServiceAccount(GOOGLE_SA_JSON))
    } catch (err) {
      throw new EngineError('translation service unavailable', 502, `google auth: ${err}`)
    }
  }
  return await translateWithGoogle(req, {
    apiKey: GOOGLE_API_KEY,
    accessToken,
    projectId: GOOGLE_PROJECT_ID,
    location: GOOGLE_LOCATION,
    glossary: GOOGLE_GLOSSARY,
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const missing = engineReadiness()
  if (missing) {
    return json(503, { error: 'translation is not configured', engine: ENGINE, missing })
  }

  const userId = await resolveUser(req.headers.get('Authorization'))
  if (!userId) return json(401, { error: 'sign in to use translation' })
  if (rateLimited(userId)) return json(429, { error: 'too many translations, try again shortly' })

  let body: {
    text?: unknown
    targetLocale?: unknown
    sourceLocale?: unknown
    question?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON' })
  }

  const text = typeof body.text === 'string' ? body.text : ''
  const target = typeof body.targetLocale === 'string' ? body.targetLocale : ''
  const source = typeof body.sourceLocale === 'string' ? body.sourceLocale : undefined
  const question = typeof body.question === 'string' ? body.question.slice(0, 1000) : ''

  if (!text.trim()) return json(400, { error: 'text is required' })
  if (text.length > MAX_INPUT_CHARS) return json(413, { error: 'text is too long to translate' })
  if (!/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(target)) {
    return json(400, { error: 'targetLocale is not a language code' })
  }
  if (source && source === target) return json(400, { error: 'source and target are the same' })

  try {
    const result = await runEngine({ text, target, source, question })
    return json(200, {
      translation: result.translation,
      unchanged: result.unchanged,
      engine: ENGINE,
      // Surfaced so the client can log latency/cost during the pilot. On the
      // Anthropic path cache_read is expected to be 0: the system prompt is ~1.8k
      // tokens, under Haiku's 4096-token minimum cacheable prefix.
      usage: result.usage ?? null,
    })
  } catch (err) {
    if (err instanceof EngineError) {
      if (err.detail) console.error('translate engine error', err.detail)
      return json(err.status, { error: err.message })
    }
    console.error('translate failed', err)
    return json(502, { error: 'translation service unreachable' })
  }
})
