import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import {
  createGenre,
  deleteGenre,
  createScopedProject,
  ensureActiveContext,
  ensureWorksheetFor,
  mergeGenres,
} from '../src/lib/storage/appState'
import { testContext } from './helpers/context'
import { upsertEntry } from '../src/lib/storage/entries'
import { duplicatePairs, editDistance, findDuplicate } from '../src/lib/genreNames'

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.entries.clear(),
    db.meta.clear(),
    db.history.clear(),
    db.recordings.clear(),
  ])
}

describe('genre name integrity (feedback 2026-07-20 #12)', () => {
  it('flags exact duplicates case- and space-insensitively', () => {
    const existing = [{ name: 'Funeral dirge' }]
    expect(findDuplicate('  funeral   DIRGE ', existing)?.kind).toBe('exact')
  })

  it('flags near duplicates but leaves distinct names alone', () => {
    const existing = [{ name: 'Funeral dirge' }, { name: 'Praise shout' }]
    expect(findDuplicate('Funeral dirges', existing)?.kind).toBe('near')
    expect(findDuplicate('Funeral dirges', existing)?.match.name).toBe('Funeral dirge')
    expect(findDuplicate('Wedding song', existing)).toBeNull()
  })

  it('short names must match exactly, not fuzzily', () => {
    expect(findDuplicate('Rap', [{ name: 'Rip' }])).toBeNull()
    expect(editDistance('Rap', 'Rip')).toBe(1)
  })

  it('finds doubles already in the list', () => {
    const pairs = duplicatePairs([
      { name: 'Lullaby' },
      { name: 'Lullabye' },
      { name: 'War chant' },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].map((g) => g.name).sort()).toEqual(['Lullaby', 'Lullabye'])
  })
})

describe('delete + merge genres', () => {
  beforeEach(clearDb)

  it('deleteGenre removes the genre, its answers, and its worksheets', async () => {
    const ctx = await testContext()
    const g = await createGenre(ctx.projectId, 'Doomed genre')
    const gctx = { ...ctx, genreId: g.id }
    await upsertEntry(gctx, 's1b.content', 'genre', { text: 'about endings' })
    const ws = await ensureWorksheetFor(ctx.projectId, ctx.focusTextId, g.id)
    await upsertEntry({ ...gctx, worksheetId: ws.id }, 'choose.flag', 'synthesis', { value: 'warning' }, 's1b.purposes')

    await deleteGenre(ctx.projectId, g.id)

    expect(await db.genres.get(g.id)).toBeUndefined()
    expect(await db.worksheets.get(ws.id)).toBeUndefined()
    const remaining = await db.entries
      .filter((e) => e.genre_id === g.id || e.worksheet_id === ws.id)
      .toArray()
    expect(remaining).toHaveLength(0)
  })

  it('mergeGenres moves non-conflicting answers and keeps the survivor on conflicts', async () => {
    const ctx = await testContext()
    const keep = await createGenre(ctx.projectId, 'Lullaby')
    const fold = await createGenre(ctx.projectId, 'Lullabye')
    await upsertEntry({ ...ctx, genreId: keep.id }, 's1b.content', 'genre', { text: 'keeper answer' })
    await upsertEntry({ ...ctx, genreId: fold.id }, 's1b.content', 'genre', { text: 'duplicate answer' })
    await upsertEntry({ ...ctx, genreId: fold.id }, 's1b.description', 'genre', { text: 'only on the duplicate' })

    await mergeGenres(ctx.projectId, fold.id, keep.id)

    expect(await db.genres.get(fold.id)).toBeUndefined()
    const content = await db.entries
      .filter((e) => e.node_id === 's1b.content' && e.genre_id === keep.id)
      .toArray()
    expect(content).toHaveLength(1)
    expect(content[0].text).toBe('keeper answer')
    const moved = await db.entries
      .filter((e) => e.node_id === 's1b.description' && e.genre_id === keep.id)
      .first()
    expect(moved?.text).toBe('only on the duplicate')
  })
})

describe('starter-record race guard (feedback 2026-07-20 #3/#4)', () => {
  beforeEach(clearDb)

  it('resolves null and creates nothing while no project exists', async () => {
    // The onboarding gate owns first-run: neither resolve call may mint a
    // project or starter containers on its own.
    const [a, b] = await Promise.all([ensureActiveContext(), ensureActiveContext()])
    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(await db.projects.count()).toBe(0)
    expect(await db.genres.count()).toBe(0)
    expect(await db.focusTexts.count()).toBe(0)
  })

  it('concurrent calls share one run and create one starter set once a project exists', async () => {
    await createScopedProject('Test culture', 'Test language', 'Test culture genres in Test language')
    const [a, b] = await Promise.all([ensureActiveContext(), ensureActiveContext()])
    expect(a).not.toBeNull()
    expect(a!.genreId).toBe(b!.genreId)
    expect(a!.focusTextId).toBe(b!.focusTextId)
    expect(await db.genres.count()).toBe(1)
    expect(await db.focusTexts.count()).toBe(1)
  })

  it('a resolve issued after a project lands never inherits a stale null', async () => {
    // Regression for the null-run single-flight fix: a run that will resolve
    // null must not stay registered as the shared in-flight promise, or a
    // retry issued after the first project row lands (gate submit, pull)
    // would inherit its stale null and the app would sit on "Loading…".
    const inFlight = ensureActiveContext()
    await createScopedProject('Test culture', 'Test language', 'Test culture genres in Test language')
    await inFlight // may be null (stale run) or a context, depending on timing
    const retry = await ensureActiveContext()
    expect(retry).not.toBeNull()
    expect(await db.projects.count()).toBe(1)
    expect(await db.genres.count()).toBe(1)
  })
})
