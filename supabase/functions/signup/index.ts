/**
 * Self-serve account creation, gated by a shared invite code.
 *
 * Why this exists at all, rather than the client calling `supabase.auth.signUp()`:
 *
 * 1. The project has no custom SMTP, and the built-in mailer sends two emails per
 *    hour PROJECT-WIDE. A signup that waits on a confirmation email therefore fails
 *    silently for the third person in any hour. Creating the user through the Admin
 *    API with `email_confirm: true` sends no email at all, so the ceiling is gone.
 * 2. A valid Supabase JWT is what authorizes the `translate` function to spend a
 *    metered API key. Open signup would make that key reachable by anyone on the
 *    internet. The invite code is the wall.
 *
 * Because callers have no JWT yet, this deploys with `--no-verify-jwt`. The platform
 * gate is OFF: the invite code and the per-IP throttle below are the entire
 * authorization. Treat any change here as a change to an internet-facing door.
 *
 * Deployed by `./scripts/enable-signup.sh`, which also sets the code, flips
 * `disable_signup` on the project so the anon key cannot create accounts, and probes
 * a wrong code expecting 403.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const INVITE_CODE = Deno.env.get('SIGNUP_INVITE_CODE')

/** bcrypt silently truncates past 72 bytes, so refuse rather than mislead. */
const MAX_PASSWORD_BYTES = 72
const MIN_PASSWORD_LENGTH = 8
const MAX_NAME_LENGTH = 100
const MAX_EMAIL_LENGTH = 254

/** Attempts allowed per IP per window, successful or not. */
const RATE_LIMIT_PER_WINDOW = 8
const RATE_WINDOW_MS = 10 * 60_000

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

/** Which secret is missing, if any. Named in the response: none of these leak a value. */
function readiness(): string | null {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return 'the function is missing its project credentials'
  if (!INVITE_CODE) return 'set SIGNUP_INVITE_CODE'
  return null
}

/**
 * In-memory sliding window, per warm isolate.
 *
 * LIMITATION, deliberately accepted, same as the translate function: Supabase may
 * run several isolates, so the true ceiling is this multiplied by the isolate count,
 * and it resets on cold start. That is fine here because it is not the primary
 * defence — a four-word invite code carries roughly 44 bits, which no amount of
 * HTTP round-trips will exhaust. This throttle exists to make brute force
 * expensive and noisy rather than impossible. Move it to a Postgres counter if the
 * code is ever shortened.
 */
const hits = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_WINDOW_MS
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff)
  recent.push(now)
  hits.set(ip, recent)
  // Bound the map so a long-lived isolate cannot grow it without limit.
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k)
  }
  return recent.length > RATE_LIMIT_PER_WINDOW
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  return fwd.split(',')[0]?.trim() || 'unknown'
}

/**
 * Length-independent comparison. Both sides are hashed first so the comparison
 * runs over equal-length digests and cannot leak the code's length either.
 */
async function secretEquals(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

/** Deliberately permissive: the Admin API is the real validator. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

interface AdminResult {
  status: number
  body: string
}

async function createUser(email: string, password: string, name: string): Promise<AdminResult> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      // No confirmation email is sent, which is the whole point: see the header.
      email_confirm: true,
      user_metadata: name ? { name } : {},
    }),
  })
  return { status: res.status, body: await res.text() }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const missing = readiness()
  if (missing) return json(503, { error: 'account creation is not configured', missing })

  const ip = clientIp(req)
  // Throttle BEFORE checking the code, so this endpoint is not a free oracle.
  if (rateLimited(ip)) {
    return json(429, { error: 'Too many attempts. Wait a few minutes and try again.' })
  }

  let body: { name?: unknown; email?: unknown; password?: unknown; code?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid JSON' })
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const code = typeof body.code === 'string' ? body.code.trim() : ''

  if (!(await secretEquals(code, INVITE_CODE!))) {
    console.warn('signup: wrong invite code', { ip, email })
    return json(403, { error: 'That invite code is not right. Check the email it came in.' })
  }

  if (!name) return json(400, { error: 'Enter your name.' })
  if (!email || email.length > MAX_EMAIL_LENGTH || !looksLikeEmail(email)) {
    return json(400, { error: 'Enter a valid email address.' })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json(400, { error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.` })
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return json(400, { error: 'That password is too long. Use 72 characters or fewer.' })
  }

  let result: AdminResult
  try {
    result = await createUser(email, password, name)
  } catch (err) {
    console.error('signup: admin call failed', err)
    return json(502, { error: 'Could not reach the account service. Try again shortly.' })
  }

  if (result.status === 200 || result.status === 201) {
    return json(200, { ok: true, email })
  }

  // The Admin API says "already been registered" (wording has shifted between
  // releases, so match loosely). This is the single most likely non-success, and
  // it deserves an instruction rather than a stack trace.
  if (/already|registered|exists|duplicate/i.test(result.body)) {
    return json(409, {
      error: 'There is already an account for that email. Sign in instead.',
      alreadyExists: true,
    })
  }

  console.error('signup: admin rejected', result.status, result.body.slice(0, 300))
  return json(502, { error: 'Could not create the account. Try again shortly.' })
})
