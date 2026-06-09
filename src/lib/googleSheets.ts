/**
 * Google Sheets export via client-side Google Identity Services (token model)
 * with the non-sensitive `drive.file` scope, so it avoids heavy app verification
 * and needs no backend. The app creates a spreadsheet it owns and writes the
 * worksheet tabs into it. Gated on VITE_GOOGLE_CLIENT_ID: with no client id the
 * feature reports as not configured and the rest of the app is unaffected.
 */
import type { SheetTab } from './export'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenResponse {
  access_token?: string
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

export function isSheetsConfigured(): boolean {
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

async function getAccessToken(): Promise<string> {
  const clientId = googleClientId()
  if (!clientId) throw new Error('No Google client id configured (VITE_GOOGLE_CLIENT_ID).')
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token)
        else reject(new Error(resp.error ?? 'Authorization failed.'))
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

async function api<T>(token: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Google API error ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

/**
 * Create a spreadsheet with one sheet per tab and write each tab's values.
 * Returns the spreadsheet URL. Requires the user to grant access in the popup.
 */
export async function exportToGoogleSheets(title: string, tabs: SheetTab[]): Promise<string> {
  if (tabs.length === 0) throw new Error('Nothing to export.')
  const token = await getAccessToken()

  const created = await api<{ spreadsheetId: string; spreadsheetUrl: string }>(
    token,
    'https://sheets.googleapis.com/v4/spreadsheets',
    {
      properties: { title },
      sheets: tabs.map((t) => ({ properties: { title: t.title } })),
    },
  )

  await api(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values:batchUpdate`,
    {
      valueInputOption: 'RAW',
      data: tabs.map((t) => ({
        range: `'${t.title.replace(/'/g, "''")}'!A1`,
        majorDimension: 'ROWS',
        values: t.values,
      })),
    },
  )

  return created.spreadsheetUrl
}
