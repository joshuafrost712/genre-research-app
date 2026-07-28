/**
 * Google service-account access tokens, minted in the Edge Function.
 *
 * Cloud Translation **v3** — the only version that can honour a glossary —
 * requires OAuth, not an API key. There is no Google auth library available here
 * that is worth the cold-start cost, and the flow is small: sign a JWT with the
 * service account's private key, exchange it for an access token, cache it.
 *
 * Two things about the cache. It lives in module scope, so it is per warm
 * isolate: a cold start pays one extra round trip, which is why the token is
 * fetched before the model call rather than lazily inside it. And it expires a
 * minute early, because a token that expires mid-flight fails the request the
 * facilitator is waiting on rather than the next one.
 */

export interface ServiceAccount {
  client_email: string
  private_key: string
  project_id?: string
}

const SCOPE = 'https://www.googleapis.com/auth/cloud-translation'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

let cached: { token: string; expiresAt: number } | null = null

/** Base64url without padding, as JWT requires. */
function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input)
  let raw = ''
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i])
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Strip the PEM armour and decode to the DER bytes importKey expects. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return der
}

export function parseServiceAccount(json: string): ServiceAccount {
  const sa = JSON.parse(json) as Partial<ServiceAccount>
  if (!sa.client_email || !sa.private_key) {
    throw new Error('service account JSON is missing client_email or private_key')
  }
  // A key pasted through a shell or an env var often arrives with literal \n.
  return {
    client_email: sa.client_email,
    private_key: sa.private_key.replace(/\\n/g, '\n'),
    project_id: sa.project_id,
  }
}

async function mint(sa: ServiceAccount): Promise<{ token: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  )

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  )
  const assertion = `${header}.${claims}.${b64url(signature)}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error('token exchange returned no access_token')

  return {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
  }
}

export async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token
  cached = await mint(sa)
  return cached.token
}
