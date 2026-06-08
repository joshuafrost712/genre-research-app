/**
 * App-state helpers over the `meta` key/value store: active project and the
 * resume cursor (last-visited worksheet node). Resume is per project so reopening
 * the app lands the facilitator exactly where they left off.
 */
import { db } from './db'
import { getContentVersion } from '../content/loader'
import type { Project } from '../types'

const ACTIVE_PROJECT = 'activeProjectId'
const lastNodeKey = (projectId: string) => `lastNode:${projectId}`

async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}

async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

function now(): string {
  return new Date().toISOString()
}

function uid(): string {
  return crypto.randomUUID()
}

export async function getActiveProjectId(): Promise<string | undefined> {
  return getMeta(ACTIVE_PROJECT)
}

export async function setActiveProject(id: string): Promise<void> {
  await setMeta(ACTIVE_PROJECT, id)
}

/**
 * Returns the active project, creating a starter one on first run so the app is
 * usable immediately. Full project setup UI arrives in a later build step.
 */
export async function ensureActiveProject(): Promise<Project> {
  const activeId = await getActiveProjectId()
  if (activeId) {
    const existing = await db.projects.get(activeId)
    if (existing) return existing
  }

  const first = await db.projects.orderBy('updated_at').last()
  if (first) {
    await setActiveProject(first.id)
    return first
  }

  const project: Project = {
    id: uid(),
    name: 'Untitled project',
    languages: [],
    team_members: [],
    scope: 'narrow',
    config_version: getContentVersion(),
    is_sensitive: false,
    created_at: now(),
    updated_at: now(),
  }
  await db.projects.put(project)
  await setActiveProject(project.id)
  return project
}

export async function getLastNode(projectId: string): Promise<string | undefined> {
  return getMeta(lastNodeKey(projectId))
}

export async function setLastNode(projectId: string, nodeId: string): Promise<void> {
  await setMeta(lastNodeKey(projectId), nodeId)
}
