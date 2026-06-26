/**
 * Sync scope: where a project's data is mirrored. A project is either "personal"
 * (the user's own Drive) or "team:<folderId>" (a shared Drive folder). The active
 * sync scope follows the active project, so moving between a personal and a team
 * project switches what gets flushed/pulled, with no Project schema migration —
 * the mapping lives in the meta store.
 */
import { db } from '../storage/db'
import { getActiveProjectId, setActiveProject } from '../storage/appState'
import { findOrCreateFolder } from '../google/drive'
import { reenqueueProject } from './outbox'

const APP_ROOT = 'Genre Research (App)'

export type SyncScope =
  | { kind: 'personal' }
  | { kind: 'team'; teamId: string; folderId: string; name: string }

export interface TeamRef {
  teamId: string
  folderId: string
  name: string
  /** The join secret, kept locally so we can re-show the invite link. */
  joinSecret?: string
}

async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}
async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

const TEAMS_KEY = 'teams'
const projectScopeKey = (projectId: string) => `projectScope:${projectId}`

export async function listTeams(): Promise<TeamRef[]> {
  const raw = await getMeta(TEAMS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TeamRef[]) : []
  } catch {
    return []
  }
}

export async function addTeam(team: TeamRef): Promise<void> {
  const teams = await listTeams()
  if (!teams.some((t) => t.folderId === team.folderId)) {
    await setMeta(TEAMS_KEY, JSON.stringify([...teams, team]))
  }
}

export async function removeTeam(folderId: string): Promise<void> {
  const teams = await listTeams()
  await setMeta(TEAMS_KEY, JSON.stringify(teams.filter((t) => t.folderId !== folderId)))
}

/** Stable string key for a scope, used to tag projects and route ops. */
export function scopeKeyOf(scope: SyncScope): string {
  return scope.kind === 'personal' ? 'personal' : `team:${scope.folderId}`
}

export async function parseScopeKey(key: string): Promise<SyncScope> {
  if (!key.startsWith('team:')) return { kind: 'personal' }
  const folderId = key.slice('team:'.length)
  const team = (await listTeams()).find((t) => t.folderId === folderId)
  return team
    ? { kind: 'team', teamId: team.teamId, folderId, name: team.name }
    : { kind: 'personal' }
}

export async function getProjectScopeKey(projectId: string): Promise<string> {
  return (await getMeta(projectScopeKey(projectId))) ?? 'personal'
}

export async function setProjectScopeKey(projectId: string, key: string): Promise<void> {
  await setMeta(projectScopeKey(projectId), key)
}

/**
 * Reassign a project to a scope and re-flush its data there. Moving a project into
 * a team uploads all of its records to the team folder so teammates can pull it.
 */
export async function moveProjectToScope(projectId: string, key: string): Promise<void> {
  await setProjectScopeKey(projectId, key)
  await reenqueueProject(projectId)
}

/**
 * Make the first locally-known project in the given scope the active project, so
 * the sync engine starts syncing that scope. Returns false if no such project
 * exists yet (e.g. a freshly-created empty team).
 */
export async function setActiveScopeProject(scopeKey: string): Promise<boolean> {
  const projects = await db.projects.toArray()
  for (const p of projects) {
    if ((await getProjectScopeKey(p.id)) === scopeKey) {
      await setActiveProject(p.id)
      return true
    }
  }
  return false
}

/** Resolve the scope of the currently active project (personal if none). */
export async function getActiveScope(): Promise<SyncScope> {
  const projectId = await getActiveProjectId()
  if (!projectId) return { kind: 'personal' }
  return parseScopeKey(await getProjectScopeKey(projectId))
}

/**
 * The Drive folder that holds a scope's per-author change shards, creating the
 * folder tree on first use. Folder ids are cached in meta to avoid re-lookups.
 */
export async function getChangesFolderId(scope: SyncScope): Promise<string> {
  if (scope.kind === 'personal') {
    const cached = await getMeta('personalChangesFolderId')
    if (cached) return cached
    const root = await findOrCreateFolder(APP_ROOT)
    const changes = await findOrCreateFolder('changes', root)
    await setMeta('personalChangesFolderId', changes)
    return changes
  }
  const cacheKey = `teamChangesFolderId:${scope.folderId}`
  const cached = await getMeta(cacheKey)
  if (cached) return cached
  const changes = await findOrCreateFolder('changes', scope.folderId)
  await setMeta(cacheKey, changes)
  return changes
}
