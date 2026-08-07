/**
 * Shared Google Identity Services (GIS) auth — the single place the app obtains a
 * Google access token. Generalised from the original Sheets-only helper so both
 * Sheets export and cloud sync share one token cache and one consent flow.
 *
 * Only the non-sensitive `drive.file` scope is ever requested: no app
 * verification, no warning screen, no 100-user cap, no seven-day consent expiry.
 *
 * The broad `drive` scope is GONE, along with the Drive team sync that was its
 * only caller. Declaring it was what held the whole OAuth client in Google's
 * Testing status, where organization-managed accounts were refused outright and
 * even a personal Gmail needed to be on a list. Do not add it back. Shared work
 * runs on Postgres now (`lib/sync/`), and anything that needs a file this app did
 * not create wants the Google Picker, which grants `drive.file` access to
 * whatever the person selects.
 *
 * Everything is gated on VITE_GOOGLE_CLIENT_ID: with no client id the whole
 * feature reports as not configured and the rest of the app is unaffected.
 */

export const SCOPES = {
  file: 'https://www.googleapis.com/auth/drive.file',
} as const
export type ScopeKey = keyof typeof SCOPES

const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void
}
interface GsiOAuth2 {
  initTokenClient: (cfg: {
    client_id: string
    scope: string
    callback: (resp: TokenResponse) => void
  }) => TokenClient
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GsiOAuth2 } }
  }
}

export function googleClientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined
}

export function isGoogleConfigured(): boolean {
  return !!googleClientId()
}

let gisLoaded: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (gisLoaded) return gisLoaded
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google Identity Services.'))
    document.head.appendChild(script)
  })
  return gisLoaded
}

interface CachedToken {
  token: string
  expiresAt: number
  scopes: string[]
}
let cached: CachedToken | null = null

function covers(c: CachedToken, scope: string): boolean {
  return c.scopes.includes(scope)
}

async function requestToken(scope: string, prompt: '' | 'consent'): Promise<CachedToken> {
  const clientId = googleClientId()
  if (!clientId) throw new Error('No Google client id configured (VITE_GOOGLE_CLIENT_ID).')
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (resp) => {
        if (resp.access_token) {
          // Expire a minute early so an in-flight request never races the deadline.
          const ttl = (Number(resp.expires_in ?? 3600) - 60) * 1000
          cached = {
            token: resp.access_token,
            expiresAt: Date.now() + ttl,
            scopes: (resp.scope ?? scope).split(' '),
          }
          resolve(cached)
        } else {
          reject(new Error(resp.error ?? 'Authorization failed.'))
        }
      },
    })
    client.requestAccessToken({ prompt })
  })
}

/**
 * Return a usable access token for the given scope, reusing the cached token when
 * it still covers the scope and has not expired. Tries a silent re-grant first;
 * on failure the caller should surface "sign in again".
 */
export async function getAccessToken(scopeKey: ScopeKey = 'file'): Promise<string> {
  const scope = SCOPES[scopeKey]
  if (cached && cached.expiresAt > Date.now() && covers(cached, scope)) {
    return cached.token
  }
  const t = await requestToken(scope, '')
  return t.token
}

/**
 * Interactive grant: forces the account chooser/consent. Used by the Sign in
 * button and by team escalation when the broad scope must be granted.
 */
export async function ensureScope(scopeKey: ScopeKey): Promise<string> {
  const scope = SCOPES[scopeKey]
  if (cached && cached.expiresAt > Date.now() && covers(cached, scope)) {
    return cached.token
  }
  const t = await requestToken(scope, 'consent')
  return t.token
}

export interface Identity {
  email: string
  name?: string
  photo?: string
}

/** Read the signed-in user's identity from Drive (works under `drive.file`). */
export async function fetchIdentity(): Promise<Identity> {
  const token = await getAccessToken('file')
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive about failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    user?: { emailAddress?: string; displayName?: string; photoLink?: string }
  }
  const u = data.user ?? {}
  return { email: u.emailAddress ?? '', name: u.displayName, photo: u.photoLink }
}

/** Drop the in-memory token; the caller also clears persisted account identity. */
export function forgetToken(): void {
  cached = null
}