/**
 * Minimal Google Drive v3 REST client — enough to store the app's JSON sync
 * shards and to create/share team folders. No SDK; just fetch with the token
 * from auth.ts. Mirrors the style of src/routing/github.ts so the two clients
 * stay symmetric.
 *
 * All file operations request the `drive.file` scope. When a team has escalated
 * to the broad `drive` scope, that token is a superset and is returned for these
 * `file`-scope requests transparently (see auth.covers), so the same functions
 * read/write a teammate's files without change.
 */
import { getAccessToken } from './auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export interface DriveFile {
  id: string
  name: string
  mimeType?: string
  modifiedTime?: string
}

export interface DrivePermission {
  id: string
  emailAddress?: string
  role: string
  type: string
}

/** Escape a value for a Drive `q` string literal. */
function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken('file')
  return { Authorization: `Bearer ${token}` }
}

async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`Drive ${what} failed: ${res.status} ${await res.text()}`)
  return res
}

/** Find files matching a query string. */
async function search(query: string): Promise<DriveFile[]> {
  const url =
    `${API}/files?q=${encodeURIComponent(query)}` +
    `&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime)')}` +
    `&pageSize=1000&spaces=drive`
  const res = await ok(await fetch(url, { headers: await authHeaders() }), 'search')
  const data = (await res.json()) as { files?: DriveFile[] }
  return data.files ?? []
}

/** First file with this exact name under a parent (null if none). */
export async function findFile(name: string, parentId: string): Promise<DriveFile | null> {
  const files = await search(`name='${q(name)}' and '${q(parentId)}' in parents and trashed=false`)
  return files[0] ?? null
}

/** Children of a folder (non-trashed). */
export async function listChildren(folderId: string): Promise<DriveFile[]> {
  return search(`'${q(folderId)}' in parents and trashed=false`)
}

/** Find a folder by name (optionally under a parent), creating it if absent. */
export async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const parentClause = parentId ? ` and '${q(parentId)}' in parents` : ''
  const existing = await search(
    `mimeType='${FOLDER_MIME}' and name='${q(name)}'${parentClause} and trashed=false`,
  )
  if (existing[0]) return existing[0].id

  const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME }
  if (parentId) metadata.parents = [parentId]
  const res = await ok(
    await fetch(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    }),
    'createFolder',
  )
  return ((await res.json()) as { id: string }).id
}

/** Create a JSON file under a parent and return its id. */
export async function uploadJson(
  parentId: string,
  name: string,
  json: unknown,
): Promise<string> {
  const metadata = { name, parents: [parentId], mimeType: 'application/json' }
  const boundary = 'genre-sync-boundary'
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    `${JSON.stringify(json)}\r\n` +
    `--${boundary}--`
  const res = await ok(
    await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: {
        ...(await authHeaders()),
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }),
    'uploadJson',
  )
  return ((await res.json()) as { id: string }).id
}

/** Replace the contents of an existing JSON file. */
export async function updateJson(fileId: string, json: unknown): Promise<void> {
  await ok(
    await fetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    }),
    'updateJson',
  )
}

/** Upsert a JSON file by name under a parent; returns its file id. */
export async function putJsonByName(
  parentId: string,
  name: string,
  json: unknown,
): Promise<string> {
  const existing = await findFile(name, parentId)
  if (existing) {
    await updateJson(existing.id, json)
    return existing.id
  }
  return uploadJson(parentId, name, json)
}

/** Download and parse a JSON file (null if it does not exist / is empty). */
export async function downloadJson<T = unknown>(fileId: string): Promise<T | null> {
  const res = await fetch(`${API}/files/${fileId}?alt=media`, { headers: await authHeaders() })
  if (res.status === 404) return null
  await ok(res, 'downloadJson')
  const text = await res.text()
  if (!text.trim()) return null
  return JSON.parse(text) as T
}

/** Grant access to a file/folder. `anyone` = link sharing; `user` emails an invite. */
export async function createPermission(
  fileId: string,
  perm: { type: 'user' | 'anyone'; role: 'reader' | 'writer'; emailAddress?: string },
): Promise<void> {
  const sendEmail = perm.type === 'user'
  const body: Record<string, unknown> = { role: perm.role, type: perm.type }
  if (perm.emailAddress) body.emailAddress = perm.emailAddress
  await ok(
    await fetch(
      `${API}/files/${fileId}/permissions?sendNotificationEmail=${sendEmail}&fields=id`,
      {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    'createPermission',
  )
}

/** List who can access a file/folder (owner uses this for the member list). */
export async function listPermissions(fileId: string): Promise<DrivePermission[]> {
  const url = `${API}/files/${fileId}/permissions?fields=${encodeURIComponent('permissions(id,emailAddress,role,type)')}`
  const res = await ok(await fetch(url, { headers: await authHeaders() }), 'listPermissions')
  return ((await res.json()) as { permissions?: DrivePermission[] }).permissions ?? []
}

/** Remove a permission (owner removing a member). */
export async function deletePermission(fileId: string, permissionId: string): Promise<void> {
  await ok(
    await fetch(`${API}/files/${fileId}/permissions/${permissionId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    }),
    'deletePermission',
  )
}