/**
 * Self-serve account creation, gated by a shared invite code OR a team join code
 * (see isTeamJoinCode for the one-code rationale and its security accounting).
 *
 * Why this exists at all, rather than the client calling `supabase.auth.signUp()`:
 *
 * 1. A valid Supabase JWT is what authorizes the `translate` function to spend a
 *    metered API key. Open signup would make that key reachable by anyone on the
 *    internet. The invite code is the wall. This is the load-bearing reason and it
 *    is permanent.
 * 2. Creating the user through the Admin API with `email_confirm: true` sends no
 *    email at all, so signup cannot fail on mail delivery and nobody waits on an
 *    inbox to start working. This began as a workaround for the built-in mailer's
 *    two-per-hour project-wide ceiling; custom SMTP (Brevo) has since removed that
 *    ceiling, but skipping the confirmation round trip is worth keeping on its own
 *    merits for a room full of people signing up at once.
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

/**
 * Attempts allowed per IP per window, successful or not.
 *
 * Raised from 8 on 2026-08-06. The throttle keys on the first x-forwarded-for
 * hop, and a room full of people on one conference access point shares a single
 * public IP. At 8 the ninth person to sign up at a workshop is refused, with an
 * error indistinguishable from mistyping the invite code, and everyone after
 * them too. That is the exact scenario this app is being built for.
 *
 * The invite code, not this number, is the wall. This exists to stop someone
 * grinding codes, and 200 in ten minutes is still far too slow to search a
 * ~36-bit space while leaving a whole cohort room to sign up at once.
 */
const RATE_LIMIT_PER_WINDOW = 200
const RATE_WINDOW_MS = 10 * 60_000

/**
 * A separate, much tighter bucket for join-code lookups only. The invite code is
 * checked locally in constant time and costs nothing; a join-code guess costs a
 * PostgREST round trip and, before 2026-08-24, was not possible at all without a
 * signed-in session. Thirty per IP per window is a whole table of people
 * mistyping, and a rounding error against the ~2^29 code space. The invite-code
 * signups of a busy room never touch this bucket.
 */
const JOIN_LOOKUP_LIMIT_PER_WINDOW = 30

/** gen_join_code() emits exactly three lowercase words and three digits. */
const JOIN_CODE_SHAPE = /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/

/**
 * A join code opens signup only while its team is recent. Codes never expire for
 * JOINING (that is deliberate; see the migration), but every team ever published
 * would otherwise permanently widen the set of codes that can mint accounts, so
 * the wall would only ever decay. Fourteen days comfortably covers a workshop.
 */
const JOIN_CODE_MAX_AGE_DAYS = 14

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
 * defence. The code `enable-signup.sh` generates carries about 36 bits, which no
 * volume of HTTP round-trips will exhaust; this throttle exists to make brute force
 * expensive and noisy rather than impossible. Move it to a Postgres counter if the
 * code is ever shortened, or if this ever guards something worth real money.
 */
const hits = new Map<string, number[]>()
const joinHits = new Map<string, number[]>()

function bumpWindow(map: Map<string, number[]>, ip: string, limit: number): boolean {
  const now = Date.now()
  const cutoff = now - RATE_WINDOW_MS
  const recent = (map.get(ip) ?? []).filter((t) => t > cutoff)
  recent.push(now)
  map.set(ip, recent)
  // Bound the map so a long-lived isolate cannot grow it without limit.
  if (map.size > 500) {
    for (const [k, v] of map) if (!v.some((t) => t > cutoff)) map.delete(k)
  }
  return recent.length > limit
}

function rateLimited(ip: string): boolean {
  return bumpWindow(hits, ip, RATE_LIMIT_PER_WINDOW)
}

function joinLookupLimited(ip: string): boolean {
  return bumpWindow(joinHits, ip, JOIN_LOOKUP_LIMIT_PER_WINDOW)
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  return fwd.split(',')[0]?.trim() || 'unknown'
}

/**
 * Make a hand-retyped code comparable, without making it guessable.
 *
 * A participant was locked out on 2026-08-07 by a code that was very nearly
 * right, and the wall this is meant to be should stop attackers, not typists.
 * Everything removed here is something a human or their software adds on the way
 * from an email to a form field, and none of it carries any of the code's
 * entropy: the generator (scripts/enable-signup.sh) emits lowercase ASCII words
 * joined by plain hyphens, so lowercasing and repairing dashes cannot collide two
 * different codes.
 *
 * The unicode dash class is not paranoia. Mail clients and word processors
 * silently autocorrect `-` to an en dash, and the result is visually identical to
 * the code that was sent.
 *
 * Applied to BOTH sides of the comparison, so the stored secret is normalised the
 * same way the submitted one is. The client normalises too, for its own shape
 * hint; if the two ever drift, this side is authoritative and is deliberately the
 * more permissive of the two.
 */
function normalizeCode(value: string): string {
  return value
    .replace(/[‐-―−]/g, '-') // en/em dash, minus sign → hyphen
    .replace(/[\s'"`‘’“”]/g, '') // spaces and any flavour of quote
    .replace(/[.,;!]+$/, '') // a sentence's punctuation, pasted along with the code
    .toLowerCase()
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

/**
 * A TEAM JOIN CODE also opens this door (added 2026-08-24, for the Psalms
 * workshop). A participant used to need two codes from two channels: the
 * app-wide invite code to exist, then their team's join code to belong. The one
 * on the whiteboard is the join code, so it is the one they have.
 *
 * Security accounting, so nobody has to redo it: a join code is three words and
 * a number (~28 bits) against the invite code's four (~36). But the join code
 * already unlocks the thing worth having — the team's data, via join_project —
 * so honouring it here adds account creation to a capability it effectively
 * implied. The throttle above still applies before this lookup runs, and the
 * invite code keeps working unchanged.
 *
 * The lookup is a PostgREST equality match on the normalised code with the
 * service key. `eq` takes the value verbatim (no pattern operators), and the
 * URL-encoding below keeps a hostile code from smuggling extra query
 * parameters. Stored codes come from gen_join_code() already in normal form
 * (lowercase hyphenated words + digits), so normalise-then-eq is exact. The
 * response never says which team matched: the same yes/no join_project already
 * gives, and nothing more.
 */
async function isTeamJoinCode(code: string): Promise<boolean> {
  const oldest = new Date(Date.now() - JOIN_CODE_MAX_AGE_DAYS * 86_400_000).toISOString()
  const url =
    `${SUPABASE_URL}/rest/v1/shared_projects?select=project_id` +
    `&join_code=eq.${encodeURIComponent(code)}` +
    `&created_at=gte.${encodeURIComponent(oldest)}&limit=1`
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) {
    // Fail CLOSED: an unreachable table must read as "not a join code", never
    // as an open door. The invite-code path is unaffected either way.
    console.error('signup: join-code lookup failed', res.status)
    return false
  }
  const rows = (await res.json()) as unknown[]
  return Array.isArray(rows) && rows.length === 1
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

  // Field validation runs BEFORE any join-code lookup, on purpose. If the code
  // were checked first, a request carrying only {code} would answer 403 for a
  // wrong guess and 400 ("enter your name") for a right one — a free oracle that
  // creates nothing. This way every probe needs a full, valid registration, so a
  // confirmed guess costs the attacker an account creation, which is loud.
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

  // Invite code first (constant-time, local, free). Only a non-match goes on to
  // the join-code path, which pays a PostgREST round trip and therefore sits
  // behind its own tighter throttle plus a shape pre-filter, so malformed
  // guesses never leave this isolate.
  const normalized = normalizeCode(code)
  const wrongCode = () =>
    json(403, {
      error:
        'That code is not right. Use your team code (three words and a number) or the invite code from your email — check that none of it is missing.',
    })
  if (!(await secretEquals(normalized, normalizeCode(INVITE_CODE!)))) {
    if (!JOIN_CODE_SHAPE.test(normalized)) {
      console.warn('signup: malformed code', { ip, email })
      return wrongCode()
    }
    if (joinLookupLimited(ip)) {
      return json(429, { error: 'Too many attempts. Wait a few minutes and try again.' })
    }
    if (!(await isTeamJoinCode(normalized))) {
      console.warn('signup: unknown join code', { ip, email })
      return wrongCode()
    }
    // Distinct log line so a code-grinding attempt is visible in function logs.
    console.log('signup: join-code signup', { ip, email })
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
