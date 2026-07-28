/**
 * Translation proxy (Lane A, the interactive path).
 *
 * Holds the Anthropic key server-side and translates one field at a time fast
 * enough for a team to sit and wait: the client's budget is under two seconds.
 *
 * Deployed with:
 *   supabase functions deploy translate
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *
 * Design decisions worth knowing before changing this:
 *
 * 1. The client cannot supply a prompt. It sends structured fields only (text,
 *    target locale, and the question being answered). The prompt comes from
 *    contract.generated.json, produced from src/lib/translate/prompt.ts by
 *    `npm run i18n:contract`. If the client could send a prompt, any beta login
 *    would be arbitrary model access on Joshua's key.
 * 2. A Supabase JWT is required. The app already signs beta testers in, so this
 *    reuses an identity that exists rather than inventing a shared secret, and it
 *    gives a per-user handle for rate limiting.
 * 3. Structured output is mandatory, so a preamble can never be written into a
 *    team's answer field.
 */
import contract from './contract.generated.json' with { type: 'json' }

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

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
 * In-memory sliding window, per warm isolate.
 *
 * LIMITATION, deliberately accepted: Supabase may run several isolates, so the
 * effective ceiling is this multiplied by the isolate count, and it resets on cold
 * start. It is a guard against a runaway client loop, not a billing control. The
 * real spend ceiling is the Anthropic account's own limit, and for this workload
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  if (!ANTHROPIC_KEY) return json(503, { error: 'translation is not configured' })

  const userId = await resolveUser(req.headers.get('Authorization'))
  if (!userId) return json(401, { error: 'sign in to use translation' })
  if (rateLimited(userId)) return json(429, { error: 'too many translations, try again shortly' })

  let body: { text?: unknown; targetLocale?: unknown; question?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON' })
  }

  const text = typeof body.text === 'string' ? body.text : ''
  const targetLocale = typeof body.targetLocale === 'string' ? body.targetLocale : ''
  const question = typeof body.question === 'string' ? body.question.slice(0, 1000) : ''

  if (!text.trim()) return json(400, { error: 'text is required' })
  if (text.length > MAX_INPUT_CHARS) return json(413, { error: 'text is too long to translate' })

  const system = (contract.systemPrompts as Record<string, string>)[targetLocale]
  if (!system) return json(400, { error: `no translation contract for locale ${targetLocale}` })

  // The question is context the model may read, never content to translate; it is
  // fenced so a question containing instructions cannot redirect the task.
  const userMessage = question
    ? [
        'Context — the worksheet question being answered (do NOT translate this, it is',
        'only here to disambiguate the answer):',
        question,
        '',
        'Translate this answer:',
        text,
      ].join('\n')
    : ['Translate this answer:', text].join('\n')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: contract.model,
        max_tokens: contract.maxTokens,
        system,
        output_config: { format: { type: 'json_schema', schema: contract.outputSchema } },
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('anthropic error', res.status, detail.slice(0, 500))
      // Pass 429 through so the client can back off; collapse everything else to
      // 502 rather than leaking upstream error shapes to the browser.
      return json(res.status === 429 ? 429 : 502, { error: 'translation service unavailable' })
    }

    const payload = (await res.json()) as {
      content?: { type: string; text?: string }[]
      stop_reason?: string
      usage?: Record<string, number>
    }

    // Structured output guarantees the first text block is the JSON object.
    const raw = payload.content?.find((b) => b.type === 'text')?.text ?? ''
    let parsed: { translation?: string; unchanged?: boolean }
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('unparseable model output', raw.slice(0, 300))
      return json(502, { error: 'translation service returned an unexpected shape' })
    }
    if (!parsed.translation?.trim()) return json(502, { error: 'empty translation' })

    return json(200, {
      translation: parsed.translation,
      unchanged: parsed.unchanged === true,
      // Surfaced so the client can log latency/cost during the pilot. cache_read
      // is expected to be 0: the system prompt is ~1.8k tokens, under Haiku's
      // 4096-token minimum cacheable prefix.
      usage: payload.usage ?? null,
    })
  } catch (err) {
    console.error('translate failed', err)
    return json(502, { error: 'translation service unreachable' })
  }
})
