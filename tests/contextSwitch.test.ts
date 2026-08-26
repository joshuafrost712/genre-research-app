import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { testContext } from './helpers/context'
import {
  createFocusText,
  createGenre,
  ensureWorksheetFor,
  type ActiveContext,
} from '../src/lib/storage/appState'
import { upsertEntry } from '../src/lib/storage/entries'
import { computeProgress, subsectionCounts, subsectionLayers } from '../src/lib/progress'
import { navTree, subsectionForPath } from '../src/lib/content/loader'
import { visibleAtDepth } from '../src/schema/types'

const MODE = 'standard' as const

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.capturedNotes.clear(),
    db.entries.clear(),
    db.persons.clear(),
    db.meta.clear(),
  ])
}

const allEntries = () => db.entries.toArray()

/** Every subsection the nav shows at this depth. */
function visibleSubIds(): string[] {
  return navTree().flatMap(({ subsections }) =>
    subsections.filter((s) => visibleAtDepth(s, MODE)).map((s) => s.id),
  )
}

describe('subsectionCounts agrees with computeProgress', () => {
  beforeEach(clearDb)

  /**
   * The invariant that keeps the switcher honest. The sidebar prints
   * `computeProgress().bySubsection[id]` for every subsection (NavShell), so a
   * menu that computed the same number a different way and disagreed would make
   * the app contradict itself on screen.
   */
  it('matches on every subsection, for a context with answers in all three layers', async () => {
    const ctx = await testContext()
    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })
    await upsertEntry(ctx, 's0.purpose.specific', 'focusText', { text: 'this lament' })
    await upsertEntry(ctx, 's0.genre_choice.chosen', 'synthesis', { text: 'Sung lament' })

    const entries = await allEntries()
    const expected = computeProgress(entries, ctx, MODE).bySubsection

    for (const subId of visibleSubIds()) {
      const [got] = subsectionCounts(entries, subId, [ctx], MODE)
      expect({ subId, ...got }).toEqual({ subId, ...expected[subId] })
    }
  })

  /**
   * The specific shape that broke the first draft of this feature.
   *
   * `s0.genre_choice` declares itself synthesis-layer, but four of its six
   * answerable leaves are focusText-layer. Resolving the layer once per
   * SUBSECTION (the way genreProgress does, correctly, for its own purpose)
   * silently drops those four and reports 2. The sidebar says 6. Resolving per
   * LEAF is what makes them agree.
   */
  it('sees all six leaves of the mixed-layer s0.genre_choice, not just the two synthesis ones', async () => {
    const ctx = await testContext()
    // Answer one leaf from EACH of the two layers this subsection mixes. `total`
    // alone would not catch the defect: it is leaves.length either way. Only
    // `done` moves, and only for the focusText leaf that a subsection-level
    // layer filter throws away.
    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })
    await upsertEntry(ctx, 's0.genre_choice.chosen', 'synthesis', { text: 'Sung lament' })

    const entries = await allEntries()
    const [count] = subsectionCounts(entries, 's0.genre_choice', [ctx], MODE)
    const sidebar = computeProgress(entries, ctx, MODE).bySubsection['s0.genre_choice']

    expect(count.total).toBe(6)
    expect(count.done).toBe(2)
    expect(count).toEqual(sidebar)
  })
})

describe('candidate contexts', () => {
  beforeEach(clearDb)

  /**
   * A pair nobody has opened yet has no worksheet row, so its synthesis
   * container id is the empty string. `buildIndex` folds a container-less entry
   * to '' too, so without an explicit guard the two match and every unopened
   * pair inherits a stray row's answers as its own.
   */
  it('reports no synthesis answers for a candidate with no worksheet, even beside a container-less row', async () => {
    const ctx = await testContext()
    // A legacy/stray row with no container of any kind, written straight to the
    // table because upsertEntry always assigns one.
    await db.entries.add({
      id: 'stray-row',
      project_id: ctx.projectId,
      node_id: 's0.genre_choice.chosen',
      text: 'orphaned answer',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const unopened: ActiveContext = { ...ctx, worksheetId: '' }
    const [count] = subsectionCounts(await allEntries(), 's0.genre_choice', [unopened], MODE)
    expect(count.done).toBe(0)
  })

  /** Switching genre must not carry the other genre's answers across. */
  it('separates two genres on a genre-layer answer', async () => {
    const ctx = await testContext()
    const other = await createGenre(ctx.projectId, 'Praise song')
    const otherWs = await ensureWorksheetFor(ctx.projectId, ctx.focusTextId, other.id)
    const otherCtx: ActiveContext = {
      projectId: ctx.projectId,
      focusTextId: ctx.focusTextId,
      genreId: other.id,
      worksheetId: otherWs.id,
    }

    await upsertEntry(ctx, 's1b.description', 'genre', { text: 'A sung lament for a death' })

    const entries = await allEntries()
    const [mine, theirs] = subsectionCounts(entries, 's1b', [ctx, otherCtx], MODE)
    expect(mine.done).toBe(1)
    expect(theirs.done).toBe(0)
    expect(mine.total).toBe(theirs.total) // same step, so the same denominator
  })

  /** And a focusText answer must not follow you to another passage. */
  it('separates two passages on a focusText-layer answer', async () => {
    const ctx = await testContext()
    const other = await createFocusText(ctx.projectId, 'Psalm 13:1-6')
    const otherWs = await ensureWorksheetFor(ctx.projectId, other.id, ctx.genreId)
    const otherCtx: ActiveContext = {
      projectId: ctx.projectId,
      focusTextId: other.id,
      genreId: ctx.genreId,
      worksheetId: otherWs.id,
    }

    await upsertEntry(ctx, 's0.purpose.general', 'focusText', { text: 'to encourage' })

    const entries = await allEntries()
    const [mine, theirs] = subsectionCounts(entries, 's0.genre_choice', [ctx, otherCtx], MODE)
    expect(mine.done).toBe(1)
    expect(theirs.done).toBe(0)
  })
})

describe('subsectionLayers', () => {
  it('reports the mixed layers of s0.genre_choice', () => {
    expect([...subsectionLayers('s0.genre_choice', MODE)].sort()).toEqual([
      'focusText',
      'synthesis',
    ])
  })

  it('reports a single layer for an ordinary genre-layer subsection', () => {
    expect(subsectionLayers('s1b', MODE)).toEqual(['genre'])
  })

  it('is empty for an unknown id, rather than throwing', () => {
    expect(subsectionLayers('no.such.subsection', MODE)).toEqual([])
  })
})

describe('subsectionForPath', () => {
  it('reads the subsection out of a worksheet route', () => {
    expect(subsectionForPath('/worksheet/s1b')).toBe('s1b')
  })

  it('resolves a deep node id to the subsection that contains it', () => {
    expect(subsectionForPath('/worksheet/s0.purpose.general')).toBe('s0.genre_choice')
  })

  it('inverts the dedicated page routes', () => {
    expect(subsectionForPath('/choose')).toBe('s0.genre_choice')
    expect(subsectionForPath('/macro')).toBe('s0.macro_notes')
    expect(subsectionForPath('/style')).toBe('s0.stylistic_notes')
  })

  it('tolerates a trailing slash', () => {
    expect(subsectionForPath('/choose/')).toBe('s0.genre_choice')
  })

  it('returns null on the pages that are not a step', () => {
    for (const path of ['/', '/genres', '/export', '/summary', '/routing', '/review', '/chart']) {
      expect(subsectionForPath(path)).toBeNull()
    }
  })

  /** The wizard is resolved by the caller, since its sequence lives elsewhere. */
  it('returns null for /wizard rather than guessing', () => {
    expect(subsectionForPath('/wizard')).toBeNull()
  })
})
