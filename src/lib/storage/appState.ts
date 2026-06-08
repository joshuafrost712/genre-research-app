/**
 * App-state helpers over the `meta` key/value store: active project and the
 * resume cursor (last-visited worksheet node). Resume is per project so reopening
 * the app lands the facilitator exactly where they left off.
 */
import { db } from './db'
import { getContentVersion } from '../content/loader'
import { now, uid } from '../util'
import type { FocusText, Genre, Project, TranslationWorksheet } from '../types'

const ACTIVE_PROJECT = 'activeProjectId'
const lastNodeKey = (projectId: string) => `lastNode:${projectId}`
const activeFocusTextKey = (projectId: string) => `activeFocusText:${projectId}`
const activeGenreKey = (projectId: string) => `activeGenre:${projectId}`
const activeWorksheetKey = (projectId: string) => `activeWorksheet:${projectId}`

async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}

async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
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

/**
 * The active editing context. Entries attach to a container chosen by the node's
 * layer: genre answers to the active Genre, focus-text answers to the active
 * FocusText, synthesis answers to the active TranslationWorksheet (a focus-text
 * and genre pairing). Starter rows are created on first run so capture works
 * immediately; full setup and a genre bank with switching arrive in later steps.
 */
export interface ActiveContext {
  projectId: string
  focusTextId: string
  genreId: string
  worksheetId: string
}

export async function ensureActiveContext(): Promise<ActiveContext> {
  const project = await ensureActiveProject()
  const projectId = project.id

  const focusText = await ensureActiveFocusText(projectId)
  const genre = await ensureActiveGenre(projectId)
  const worksheet = await ensureActiveWorksheet(projectId, focusText.id, genre.id)

  return { projectId, focusTextId: focusText.id, genreId: genre.id, worksheetId: worksheet.id }
}

async function ensureActiveFocusText(projectId: string): Promise<FocusText> {
  const activeId = await getMeta(activeFocusTextKey(projectId))
  if (activeId) {
    const existing = await db.focusTexts.get(activeId)
    if (existing) return existing
  }
  const existing = await db.focusTexts.where('project_id').equals(projectId).first()
  if (existing) {
    await setMeta(activeFocusTextKey(projectId), existing.id)
    return existing
  }
  const focusText: FocusText = {
    id: uid(),
    project_id: projectId,
    reference: 'Untitled focus text',
    created_at: now(),
  }
  await db.focusTexts.put(focusText)
  await setMeta(activeFocusTextKey(projectId), focusText.id)
  return focusText
}

async function ensureActiveGenre(projectId: string): Promise<Genre> {
  const activeId = await getMeta(activeGenreKey(projectId))
  if (activeId) {
    const existing = await db.genres.get(activeId)
    if (existing) return existing
  }
  const existing = await db.genres.where('project_id').equals(projectId).first()
  if (existing) {
    await setMeta(activeGenreKey(projectId), existing.id)
    return existing
  }
  const genre: Genre = {
    id: uid(),
    project_id: projectId,
    name: 'Untitled genre',
    is_sensitive: false,
    created_at: now(),
    updated_at: now(),
  }
  await db.genres.put(genre)
  await setMeta(activeGenreKey(projectId), genre.id)
  return genre
}

// --- focus text + genre management (the context switcher) -----------------

export async function setActiveFocusText(projectId: string, id: string): Promise<void> {
  await setMeta(activeFocusTextKey(projectId), id)
}

export async function setActiveGenre(projectId: string, id: string): Promise<void> {
  await setMeta(activeGenreKey(projectId), id)
}

export async function createFocusText(projectId: string, reference: string): Promise<FocusText> {
  const focusText: FocusText = {
    id: uid(),
    project_id: projectId,
    reference: reference.trim() || 'Untitled focus text',
    created_at: now(),
  }
  await db.focusTexts.put(focusText)
  await setActiveFocusText(projectId, focusText.id)
  return focusText
}

export async function createGenre(projectId: string, name: string): Promise<Genre> {
  const genre: Genre = {
    id: uid(),
    project_id: projectId,
    name: name.trim() || 'Untitled genre',
    is_sensitive: false,
    created_at: now(),
    updated_at: now(),
  }
  await db.genres.put(genre)
  await setActiveGenre(projectId, genre.id)
  return genre
}

export async function renameFocusText(id: string, reference: string): Promise<void> {
  await db.focusTexts.update(id, { reference: reference.trim() || 'Untitled focus text' })
}

export async function renameGenre(id: string, name: string): Promise<void> {
  await db.genres.update(id, { name: name.trim() || 'Untitled genre', updated_at: now() })
}

async function ensureActiveWorksheet(
  projectId: string,
  focusTextId: string,
  genreId: string,
): Promise<TranslationWorksheet> {
  const activeId = await getMeta(activeWorksheetKey(projectId))
  if (activeId) {
    const existing = await db.worksheets.get(activeId)
    if (existing && existing.focus_text_id === focusTextId && existing.genre_id === genreId) {
      return existing
    }
  }
  const existing = await db.worksheets
    .where('project_id')
    .equals(projectId)
    .filter((w) => w.focus_text_id === focusTextId && w.genre_id === genreId)
    .first()
  if (existing) {
    await setMeta(activeWorksheetKey(projectId), existing.id)
    return existing
  }
  const worksheet: TranslationWorksheet = {
    id: uid(),
    project_id: projectId,
    focus_text_id: focusTextId,
    genre_id: genreId,
    status: 'draft',
    created_at: now(),
    updated_at: now(),
  }
  await db.worksheets.put(worksheet)
  await setMeta(activeWorksheetKey(projectId), worksheet.id)
  return worksheet
}
