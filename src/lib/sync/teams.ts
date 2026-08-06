/**
 * Teams, the Drive implementation. **Switched off** behind `TEAMS_ENABLED`; see
 * `lib/features.ts` for why, and for what replaces it. Kept on disk only so the
 * shape of the problem it solved is available while the Postgres version is built.
 * Delete this file when that ships.
 *
 * A team is a shared Drive folder. Creating one needs the broad `drive` scope (a
 * teammate's file is invisible to `drive.file`), so team actions trigger incremental
 * consent, and that one requirement is what put the whole app behind Google's
 * unverified-app wall. Teams are non-discoverable: there is no registry or search;
 * access is only via an explicit Drive share, an email invite or a secret link.
 *
 * The Drive link is the real access secret. Our app-level `joinSecret` is a second
 * factor (verified against a hash stored in team.json) and a point we could revoke
 * at the app level later.
 */
import { ensureScope } from '../google/auth'
import { TEAMS_ENABLED } from '../features'
import { getAccount } from '../google/account'
import {
  createPermission,
  deletePermission,
  downloadJson,
  findFile,
  findOrCreateFolder,
  listPermissions,
  listSharedFolders,
  putJsonByName,
  type DrivePermission,
} from '../google/drive'
import { addTeam, listTeams, removeTeam, type TeamRef } from './scope'
import { pull } from './pull'
import { now, uid } from '../util'

const TEAM_FILE = 'team.json'
const TEAM_SCHEMA_VERSION = '1'
const TEAM_FOLDER_PREFIX = 'Genre Research Team — '

interface TeamMeta {
  schemaVersion: string
  teamId: string
  name: string
  ownerEmail?: string
  joinSecretHash?: string
  createdAt: string
}

export interface CreatedTeam extends TeamRef {
  joinSecret: string
  joinLink: string
}

/**
 * Enforced in code, not just by hiding the nav entry. Every function below asks
 * Google for the restricted full `drive` scope, and the app's whole Google posture
 * now depends on that scope never being requested (see `lib/features.ts`). A
 * forgotten route or a stale bookmark must not be able to reach it.
 */
function assertTeamsEnabled(): void {
  if (!TEAMS_ENABLED) {
    throw new Error(
      'Shared teams are being rebuilt so they work without a Google account. Your own work is unaffected.',
    )
  }
}

function randomToken(bytes = 18): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, '').slice(0, 24)
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function buildJoinLink(folderId: string, secret: string): string {
  const base = import.meta.env.BASE_URL // ends with '/'
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return `${origin}${base}teams/join?f=${encodeURIComponent(folderId)}&s=${encodeURIComponent(secret)}`
}

/** Create a team folder, set link-sharing, and register it locally. */
export async function createTeam(name: string): Promise<CreatedTeam> {
  assertTeamsEnabled()
  await ensureScope('full')
  const folderId = await findOrCreateFolder(`Genre Research Team — ${name}`)
  const teamId = uid()
  const joinSecret = randomToken()
  const meta: TeamMeta = {
    schemaVersion: TEAM_SCHEMA_VERSION,
    teamId,
    name,
    ownerEmail: (await getAccount())?.email,
    joinSecretHash: await sha256Hex(joinSecret),
    createdAt: now(),
  }
  await putJsonByName(folderId, TEAM_FILE, meta)
  // Anyone with the link can edit; the app-level secret gates joining.
  await createPermission(folderId, { type: 'anyone', role: 'writer' })

  const ref: TeamRef = { teamId, folderId, name, joinSecret }
  await addTeam(ref)
  return { ...ref, joinSecret, joinLink: buildJoinLink(folderId, joinSecret) }
}

/** Redeem a folder id + secret: verify, register locally, pull the team's data. */
export async function joinByCode(folderId: string, secret: string): Promise<TeamRef> {
  assertTeamsEnabled()
  await ensureScope('full')
  const file = await findFile(TEAM_FILE, folderId)
  if (!file) {
    throw new Error(
      'Could not open that team. Check the link, or ask the owner to share the folder with your Google account.',
    )
  }
  const meta = await downloadJson<TeamMeta>(file.id)
  if (!meta) throw new Error('That team folder is missing its team data.')
  if (meta.joinSecretHash && (await sha256Hex(secret)) !== meta.joinSecretHash) {
    throw new Error('That join code is not valid for this team.')
  }
  const ref: TeamRef = { teamId: meta.teamId, folderId, name: meta.name, joinSecret: secret }
  await addTeam(ref)
  await pull({ kind: 'team', teamId: meta.teamId, folderId, name: meta.name })
  return ref
}

/**
 * Find teams shared with this account (e.g. via an email invite) and register any
 * that are new. An email invite only grants a Drive permission — Google's own
 * notification links to the folder, not to the app's join link — so the team never
 * appears locally until the invitee runs this. The Drive share is itself the access
 * grant, so no join secret is required here.
 */
export async function discoverTeams(): Promise<TeamRef[]> {
  assertTeamsEnabled()
  await ensureScope('full') // shared folders are invisible to drive.file
  const known = new Set((await listTeams()).map((t) => t.folderId))
  const folders = (await listSharedFolders()).filter(
    (f) => f.name.startsWith(TEAM_FOLDER_PREFIX) && !known.has(f.id),
  )
  const added: TeamRef[] = []
  for (const folder of folders) {
    const file = await findFile(TEAM_FILE, folder.id)
    if (!file) continue // a like-named folder that isn't actually a team
    const meta = await downloadJson<TeamMeta>(file.id)
    if (!meta?.teamId) continue
    // No joinSecret: the secret only re-shows the invite link, which only the owner needs.
    const ref: TeamRef = { teamId: meta.teamId, folderId: folder.id, name: meta.name }
    await addTeam(ref)
    await pull({ kind: 'team', teamId: meta.teamId, folderId: folder.id, name: meta.name })
    added.push(ref)
  }
  return added
}

/** Invite a teammate by email (Google emails them the share). */
export async function inviteByEmail(folderId: string, email: string): Promise<void> {
  assertTeamsEnabled()
  await ensureScope('full')
  await createPermission(folderId, { type: 'user', role: 'writer', emailAddress: email.trim() })
}

/** Who currently has access to the team folder. */
export async function listMembers(folderId: string): Promise<DrivePermission[]> {
  assertTeamsEnabled()
  await ensureScope('full')
  return listPermissions(folderId)
}

/** Owner removes a member's access. */
export async function removeMember(folderId: string, permissionId: string): Promise<void> {
  assertTeamsEnabled()
  await ensureScope('full')
  await deletePermission(folderId, permissionId)
}

/** Leave a team locally (does not delete the shared folder). */
export async function leaveTeam(folderId: string): Promise<void> {
  await removeTeam(folderId)
}
