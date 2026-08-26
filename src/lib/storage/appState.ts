/**
 * App-state helpers over the `meta` key/value store: active project and the
 * resume cursor (last-visited worksheet node). Resume is per project so reopening
 * the app lands the facilitator exactly where they left off.
 */
import { db } from './db'
import { getContentVersion } from '../content/loader'
import { now, uid } from '../util'
import { trackDelete, trackUpsert } from '../sync/outbox'
import { parseReference } from '../bibleBooks'
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

/** Generic meta access for page-level preferences (e.g. summary-table columns). */
export async function getMetaValue(key: string): Promise<string | undefined> {
  return getMeta(key)
}

export async function setMetaValue(key: string, value: string): Promise<void> {
  await setMeta(key, value)
}

/**
 * Per-tour "already seen" flag. Each guided tour is tracked independently (one
 * meta key per tour id) so a new page tour can run for the first time without
 * re-triggering tours the user already finished. Stored in `meta` so it can ride
 * the same per-account sync path as the rest of app state when accounts land.
 */
const tourSeenKey = (tourId: string) => `tourSeen:${tourId}`

export async function isTourSeen(tourId: string): Promise<boolean> {
  return (await getMeta(tourSeenKey(tourId))) === '1'
}

export async function setTourSeen(tourId: string, seen: boolean): Promise<void> {
  await setMeta(tourSeenKey(tourId), seen ? '1' : '0')
}

export async function getActiveProjectId(): Promise<string | undefined> {
  return getMeta(ACTIVE_PROJECT)
}

export async function setActiveProject(id: string): Promise<void> {
  await setMeta(ACTIVE_PROJECT, id)
}

/**
 * The name every project is born with, until somebody names their team.
 *
 * Kept as a constant because it is a sentinel as much as a label: the header
 * chip, the team page and the share button all need to know "this has not been
 * named yet", and comparing against a loose string literal in five places is how
 * that check rots.
 */
export const UNNAMED_PROJECT = 'Untitled project'

/**
 * Returns the active project, or adopts the most recently updated one if the
 * active pointer is stale. Returns null when no project exists at all: first
 * run no longer mints a starter here — the OnboardingGate blocks until the
 * person either joins a team or creates a scoped project via
 * `createScopedProject`. (Until 2026-08, this function silently created an
 * 'Untitled project' instead, which is why every Psalms-workshop worksheet was
 * indistinguishable.)
 */
export async function resolveActiveProject(): Promise<Project | null> {
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

  return null
}

/** Trim, collapse inner whitespace, cap at 40 so the composed project name
 * ("{culture} genres in {language}") fits cleanProjectName's 80-char cap. */
export function cleanScopeField(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 40)
}

/**
 * Create the project the onboarding gate's "Start a new project" path asked
 * for: scoped to a culture and a language, named by the caller (normally the
 * composed "{culture} genres in {language}").
 *
 * Deliberately NOT pinned: if this person later signs into an account holding
 * real work, `adoptBestProject` stays free to weigh this project against it.
 * Re-checks for an existing project inside the call so two racing tabs (or a
 * pull landing mid-submit) adopt the winner instead of minting a duplicate.
 */
export async function createScopedProject(
  culture: string,
  language: string,
  name: string,
): Promise<Project> {
  const existing = await db.projects.orderBy('updated_at').last()
  if (existing) {
    await setActiveProject(existing.id)
    return existing
  }

  const project: Project = {
    id: uid(),
    name: cleanProjectName(name) || UNNAMED_PROJECT,
    culture: cleanScopeField(culture),
    language: cleanScopeField(language),
    languages: [],
    team_members: [],
    scope: 'narrow',
    config_version: getContentVersion(),
    is_sensitive: false,
    created_at: now(),
    updated_at: now(),
  }
  await db.projects.put(project)
  await trackUpsert('projects', project)
  await setActiveProject(project.id)
  return project
}

/**
 * Set a project's culture/language scope. Local half only: the row replicates
 * wholesale through the outbox, so there is no server mirror to order against
 * (unlike renameProject, whose display name also lives in shared_projects).
 * UI code should call setTeamScope in lib/team/scope.ts, which wraps this.
 */
export async function setProjectScope(
  id: string,
  culture: string,
  language: string,
): Promise<void> {
  await db.projects.update(id, {
    culture: cleanScopeField(culture),
    language: cleanScopeField(language),
    updated_at: now(),
  })
  const updated = await db.projects.get(id)
  if (updated) await trackUpsert('projects', updated)
}

/**
 * Name a project, i.e. name a team.
 *
 * Writes the local row and syncs it. For a project the cloud knows about, the
 * team list reads `shared_projects.name` instead, so the caller must also push
 * the name to the server — see `renameTeam` in lib/team/rename.ts, which is the
 * function the UI should use. This one is the local half.
 */
export async function renameProject(id: string, name: string): Promise<string> {
  const clean = cleanProjectName(name)
  if (!clean) return ''
  await db.projects.update(id, { name: clean, updated_at: now() })
  const updated = await db.projects.get(id)
  if (updated) await trackUpsert('projects', updated)
  return clean
}

/** Trim, collapse whitespace, cap at 80. Mirrors rename_shared_project in SQL. */
export function cleanProjectName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * Whether a project has a name a person chose, as opposed to the placeholder
 * every project is born with. The placeholder is what made every worksheet in
 * the Psalms workshop indistinguishable, so several surfaces need to ask.
 */
export function isNamedProject(name: string | undefined): boolean {
  const n = (name ?? '').trim()
  return n !== '' && n !== UNNAMED_PROJECT
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
 * and genre pairing). Starter containers are minted the moment a project exists;
 * the project itself comes from the onboarding gate (join a team, or create a
 * scoped project), never silently. Resolves null while no project exists.
 */
export interface ActiveContext {
  projectId: string
  focusTextId: string
  genreId: string
  worksheetId: string
}

// Single-flight: concurrent callers (e.g. React StrictMode's double effect, or
// two components mounting together) share one run. Without this, two
// interleaved runs each saw "nothing exists yet" and both created starter
// records / re-ran the inventory migration, duplicating every genre
// (feedback 2026-07-20 #3/#4).
let ensureInFlight: Promise<ActiveContext | null> | null = null
// Identifies the run currently registered above, so a run that has been
// superseded never clears its successor's registration. A counter rather than a
// reference comparison because the run's own body needs to test this before the
// promise variable it would compare against has been assigned.
let ensureToken = 0

/**
 * @param fresh Re-read the active keys even if a resolve is already running.
 *
 * Sharing a run is right for concurrent MOUNTS, which all want the same answer.
 * It is wrong after a deliberate switch: the context switcher writes the new
 * genre to `meta` and then asks for a re-resolve, and a run started a moment
 * earlier has already read the old key. Switching A → B → C fast enough would
 * hand the C request B's answer and leave `ctx` disagreeing with `meta`, with
 * nothing queued to correct it.
 *
 * A fresh run therefore waits for the one in progress and then reads `meta`
 * again. Waiting rather than racing keeps the original guarantee intact: two
 * resolves still never interleave, so neither can double-create starter records.
 */
export function ensureActiveContext(fresh = false): Promise<ActiveContext | null> {
  const prior = ensureInFlight
  if (prior && !fresh) return prior
  const token = ++ensureToken
  const run = (async () => {
    if (prior) await prior.catch(() => null)
    const project = await resolveActiveProject()
    if (!project) {
      // A null resolve must never be shared: a retry issued right after a
      // project row lands (gate submit, or a pull mid-resolve) needs a fresh
      // run, not this one's stale answer. Clearing here, before the promise
      // settles, is what makes the provider's state-based retry sound.
      // Guarded because a fresh run may have registered itself behind this one,
      // and clearing its registration would let a third caller start a third
      // concurrent resolve — the very thing the single flight prevents.
      if (ensureToken === token) ensureInFlight = null
      return null
    }
    const projectId = project.id

    // One-time: promote any genres entered in the old free-text 1A list into real
    // Genre records so they appear on the genres hub and in pickers (feedback #4).
    await migrateInventoryGenres(projectId)

    const focusText = await ensureActiveFocusText(projectId)
    const genre = await ensureActiveGenre(projectId)
    const worksheet = await ensureActiveWorksheet(projectId, focusText.id, genre.id)

    return { projectId, focusTextId: focusText.id, genreId: genre.id, worksheetId: worksheet.id }
  })()
  ensureInFlight = run
  const clear = () => {
    if (ensureToken === token) ensureInFlight = null
  }
  run.then(clear, clear)
  return run
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
    updated_at: now(),
  }
  await db.focusTexts.put(focusText)
  await trackUpsert('focusTexts', focusText)
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
  await trackUpsert('genres', genre)
  await setMeta(activeGenreKey(projectId), genre.id)
  return genre
}

/**
 * Migrate the pre-unification 1A "Genres you have found so far" list (stored as
 * free-text Entry rows on node `s1a.inventory`) into real Genre records. Runs
 * once per project (guarded by a meta flag); dedupes by name (case-insensitive)
 * against genres that already exist. Old entries are left in place, harmless.
 */
async function migrateInventoryGenres(projectId: string): Promise<void> {
  const flagKey = `migrated:inventoryGenres:${projectId}`
  if ((await getMeta(flagKey)) === '1') return
  const rows = await db.entries.where('node_id').equals('s1a.inventory').toArray()
  const existing = await db.genres.where('project_id').equals(projectId).toArray()
  const seen = new Set(existing.map((g) => g.name.trim().toLowerCase()))
  for (const e of rows) {
    if (e.project_id !== projectId) continue
    const name = e.text?.trim()
    if (!name || !e.cell_key || e.cell_key === '__rows') continue
    if (seen.has(name.toLowerCase())) continue
    const genre: Genre = {
      id: uid(),
      project_id: projectId,
      name,
      is_sensitive: false,
      created_at: now(),
      updated_at: now(),
    }
    await db.genres.put(genre)
    await trackUpsert('genres', genre)
    seen.add(name.toLowerCase())
  }
  await setMeta(flagKey, '1')
}

// --- focus text + genre management (the context switcher) -----------------

export async function setActiveFocusText(projectId: string, id: string): Promise<void> {
  await setMeta(activeFocusTextKey(projectId), id)
}

export async function setActiveGenre(projectId: string, id: string): Promise<void> {
  await setMeta(activeGenreKey(projectId), id)
}

export async function createFocusText(projectId: string, reference: string): Promise<FocusText> {
  const ref = reference.trim() || 'Untitled focus text'
  const focusText: FocusText = {
    id: uid(),
    project_id: projectId,
    reference: ref,
    ...parseReference(ref),
    status: 'active',
    created_at: now(),
    updated_at: now(),
  }
  await db.focusTexts.put(focusText)
  await trackUpsert('focusTexts', focusText)
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
  await trackUpsert('genres', genre)
  await setActiveGenre(projectId, genre.id)
  return genre
}

export async function renameFocusText(id: string, reference: string): Promise<void> {
  const ref = reference.trim() || 'Untitled focus text'
  const parsed = parseReference(ref)
  await db.focusTexts.update(id, {
    reference: ref,
    // Re-derive the structured fields from the new text; clear them when the new
    // reference no longer resolves so stale book/chapter never lingers.
    book: parsed.book,
    chapter: parsed.chapter,
    verse_start: parsed.verse_start,
    verse_end: parsed.verse_end,
    updated_at: now(),
  })
  const updated = await db.focusTexts.get(id)
  if (updated) await trackUpsert('focusTexts', updated)
}

/** Move a passage between the working set and the completed folder. */
export async function setFocusTextStatus(
  id: string,
  status: 'active' | 'completed',
): Promise<void> {
  await db.focusTexts.update(id, { status, updated_at: now() })
  const updated = await db.focusTexts.get(id)
  if (updated) await trackUpsert('focusTexts', updated)
}

export async function renameGenre(id: string, name: string): Promise<void> {
  await db.genres.update(id, { name: name.trim() || 'Untitled genre', updated_at: now() })
  const updated = await db.genres.get(id)
  if (updated) await trackUpsert('genres', updated)
}

/**
 * Delete a genre and everything hanging off it: its genre-layer entries, its
 * worksheets (with their synthesis entries and recordings). Exists so a double
 * or a mistaken add can be removed (feedback 2026-07-20 #12); the UI always
 * confirms with an explanation first. If the deleted genre was active, the
 * active-genre cursor moves to another genre in the project.
 */
export async function deleteGenre(projectId: string, genreId: string): Promise<void> {
  const worksheets = await db.worksheets
    .where('project_id')
    .equals(projectId)
    .filter((w) => w.genre_id === genreId)
    .toArray()
  const worksheetIds = new Set(worksheets.map((w) => w.id))

  const entries = await db.entries
    .where('project_id')
    .equals(projectId)
    .filter(
      (e) => e.genre_id === genreId || (!!e.worksheet_id && worksheetIds.has(e.worksheet_id)),
    )
    .toArray()

  for (const e of entries) {
    await db.entries.delete(e.id)
    await trackDelete('entries', e.id, projectId)
  }
  for (const w of worksheets) {
    await db.recordings.where('worksheet_id').equals(w.id).delete()
    await db.worksheets.delete(w.id)
    await trackDelete('worksheets', w.id, projectId)
  }
  await db.genres.delete(genreId)
  await trackDelete('genres', genreId, projectId)

  if ((await getMeta(activeGenreKey(projectId))) === genreId) {
    const fallback = await db.genres.where('project_id').equals(projectId).first()
    if (fallback) await setMeta(activeGenreKey(projectId), fallback.id)
  }
}

/**
 * Delete a passage and everything scoped to it: its focusText-layer entries
 * (purpose/1a/1c answers), the worksheets pairing it with any genre (with their
 * synthesis entries and recordings), then the passage itself (feedback
 * 2026-07-22 #1). The UI confirms with an explanation first. If the deleted
 * passage was the active one, the cursor moves to another passage in the project.
 */
export async function deleteFocusText(projectId: string, focusTextId: string): Promise<void> {
  const worksheets = await db.worksheets
    .where('project_id')
    .equals(projectId)
    .filter((w) => w.focus_text_id === focusTextId)
    .toArray()
  const worksheetIds = new Set(worksheets.map((w) => w.id))

  const entries = await db.entries
    .where('project_id')
    .equals(projectId)
    .filter(
      (e) =>
        e.focus_text_id === focusTextId ||
        (!!e.worksheet_id && worksheetIds.has(e.worksheet_id)),
    )
    .toArray()

  for (const e of entries) {
    await db.entries.delete(e.id)
    await trackDelete('entries', e.id, projectId)
  }
  for (const w of worksheets) {
    await db.recordings.where('worksheet_id').equals(w.id).delete()
    await db.worksheets.delete(w.id)
    await trackDelete('worksheets', w.id, projectId)
  }
  await db.focusTexts.delete(focusTextId)
  await trackDelete('focusTexts', focusTextId, projectId)

  if ((await getMeta(activeFocusTextKey(projectId))) === focusTextId) {
    const fallback = await db.focusTexts.where('project_id').equals(projectId).first()
    if (fallback) await setMeta(activeFocusTextKey(projectId), fallback.id)
  }
}

/**
 * Merge one genre into another (they turned out to be the same thing under two
 * spellings). Answers move to the surviving genre wherever it has no answer of
 * its own; where both genres answered the same question, the surviving genre's
 * answer wins and the duplicate's copy is removed with the rest of it.
 */
export async function mergeGenres(
  projectId: string,
  fromId: string,
  intoId: string,
): Promise<void> {
  if (fromId === intoId) return
  const fromEntries = await db.entries
    .where('project_id')
    .equals(projectId)
    .filter((e) => e.genre_id === fromId && !e.worksheet_id)
    .toArray()
  const intoEntries = await db.entries
    .where('project_id')
    .equals(projectId)
    .filter((e) => e.genre_id === intoId && !e.worksheet_id)
    .toArray()
  const taken = new Set(intoEntries.map((e) => `${e.node_id}::${e.cell_key ?? ''}`))
  for (const e of fromEntries) {
    if (taken.has(`${e.node_id}::${e.cell_key ?? ''}`)) continue
    await db.entries.update(e.id, { genre_id: intoId, updated_at: now() })
    const updated = await db.entries.get(e.id)
    if (updated) await trackUpsert('entries', updated)
    taken.add(`${e.node_id}::${e.cell_key ?? ''}`)
  }
  // Everything left on the duplicate (conflicting answers, worksheets, flags)
  // goes with it; the survivor keeps its own versions.
  await deleteGenre(projectId, fromId)
  await setMeta(activeGenreKey(projectId), intoId)
}

/**
 * Find or create the worksheet for a (focus text, genre) pairing WITHOUT
 * touching the active-worksheet cursor. Used when a page needs synthesis-layer
 * answers for a genre the user is only previewing (e.g. the compare page's
 * genre switcher), so browsing other genres never hijacks the active worksheet.
 */
export async function ensureWorksheetFor(
  projectId: string,
  focusTextId: string,
  genreId: string,
): Promise<TranslationWorksheet> {
  const existing = await db.worksheets
    .where('project_id')
    .equals(projectId)
    .filter((w) => w.focus_text_id === focusTextId && w.genre_id === genreId)
    .first()
  if (existing) return existing
  const worksheet: TranslationWorksheet = {
    // DETERMINISTIC, not uid(). A worksheet is uniquely identified by the pair it
    // joins, so deriving the id from that pair means two devices reaching it
    // before they have synced independently compute the SAME id and converge.
    // With a random id they each mint their own, last-write-wins keeps both, and
    // the team's synthesis answers split silently across two worksheets that are
    // mutually invisible. Dexie primary keys are plain strings, so this needs no
    // schema change and existing random ids keep working: the find-by-pair lookup
    // above runs first and never sees this line.
    id: `ws-${focusTextId}-${genreId}`,
    project_id: projectId,
    focus_text_id: focusTextId,
    genre_id: genreId,
    status: 'draft',
    created_at: now(),
    updated_at: now(),
  }
  await db.worksheets.put(worksheet)
  await trackUpsert('worksheets', worksheet)
  return worksheet
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
  const worksheet = await ensureWorksheetFor(projectId, focusTextId, genreId)
  await setMeta(activeWorksheetKey(projectId), worksheet.id)
  return worksheet
}
