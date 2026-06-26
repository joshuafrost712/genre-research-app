/**
 * Google Sheets export via client-side Google Identity Services. Auth is shared
 * with cloud sync through ./google/auth (the non-sensitive `drive.file` scope),
 * so it avoids heavy app verification and needs no backend. The app creates a
 * spreadsheet it owns and writes the worksheet tabs into it. Gated on
 * VITE_GOOGLE_CLIENT_ID: with no client id the feature reports as not configured
 * and the rest of the app is unaffected.
 */
import type { SheetTab } from './export'
import { getAccessToken, googleClientId, isGoogleConfigured } from './google/auth'

export { googleClientId }

export function isSheetsConfigured(): boolean {
  return isGoogleConfigured()
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
