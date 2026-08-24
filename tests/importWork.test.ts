/**
 * The guarantees behind "bring my earlier work into the team".
 *
 * The rules under test are the ones a workshop participant is trusting without
 * knowing it: containers merge by NAME (never by id, never on placeholders),
 * created containers get deterministic ids so two members' imports converge,
 * a clash appends below the team's answer exactly once, table rows survive via
 * a row-order union, paid-for translations are extended rather than dropped,
 * and the dry run that feeds the confirm dialog counts exactly what the real
 * run does while writing nothing.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { ensureActiveContext, type ActiveContext } from '../src/lib/storage/appState'
import { upsertEntry, findEntry, getRowIds, ROWS_KEY } from '../src/lib/storage/entries'
import { importProjectInto, listImportSources } from '../src/lib/team/importWork'
import type { Genre } from '../src/lib/types'

const SCALAR = 's0.purpose.general' // focusText layer
const TABLE = 's2c.chart' // genre layer, repeatable_row_table

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.entries.clear(),
    db.capturedNotes.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

/** A solo project with one named genre + passage and some answers. */
async function makeSource(name: string, genreName = 'Lullaby', reference = 'Psalm 13') {
  const projectId = crypto.randomUUID()
  const genreId = crypto.randomUUID()
  const ftId = crypto.randomUUID()
  const ts = new Date().toISOString()
  await db.projects.put({
    id: projectId,
    name,
    languages: [],
    team_members: [],
    scope: 'narrow',
    config_version: '1',
    is_sensitive: false,
    created_at: ts,
    updated_at: ts,
  })
  await db.genres.put({
    id: genreId,
    project_id: projectId,
    name: genreName,
    is_sensitive: false,
    created_at: ts,
    updated_at: ts,
  })
  await db.focusTexts.put({
    id: ftId,
    project_id: projectId,
    reference,
    status: 'active',
    created_at: ts,
    updated_at: ts,
  })
  const ctx: ActiveContext = { projectId, focusTextId: ftId, genreId, worksheetId: '' }
  return { projectId, genreId, ftId, ctx }
}

beforeEach(clearDb)

describe('container matching', () => {
  it('merges genres by normalized name instead of creating duplicates', async () => {
    const target = await ensureActiveContext()
    await db.genres.update(target.genreId, { name: '  lullaby ' })
    const src = await makeSource('My worksheet', 'Lullaby')
    await upsertEntry(src.ctx, TABLE, 'genre', { text: 'sung softly' }, 'row1__col1')

    const counts = await importProjectInto(src.projectId, target.projectId)
    expect(counts.genres).toBe(0)
    const targetGenres = await db.genres.where('project_id').equals(target.projectId).toArray()
    expect(targetGenres.filter((g) => g.name.trim().toLowerCase() === 'lullaby')).toHaveLength(1)
    // The answer landed in the TEAM's genre, not a new one.
    const moved = await findEntry(
      { ...target, genreId: target.genreId },
      TABLE,
      'genre',
      'row1__col1',
    )
    expect(moved?.text).toBe('sung softly')
  })

  it('creates missing genres with deterministic ids so two imports converge', async () => {
    const target = await ensureActiveContext()
    const srcA = await makeSource('A', 'Lament')
    const srcB = await makeSource('B', 'Lament')
    await upsertEntry(srcA.ctx, TABLE, 'genre', { text: 'from A' }, 'ra__c')
    await upsertEntry(srcB.ctx, TABLE, 'genre', { text: 'from B' }, 'rb__c')

    const a = await importProjectInto(srcA.projectId, target.projectId)
    const b = await importProjectInto(srcB.projectId, target.projectId)
    expect(a.genres).toBe(1)
    expect(b.genres).toBe(0) // B matched the genre A's import created
    const laments = (await db.genres.where('project_id').equals(target.projectId).toArray()).filter(
      (g: Genre) => g.name === 'Lament',
    )
    expect(laments).toHaveLength(1)
    expect(laments[0].id.startsWith('g-')).toBe(true)
  })

  it('never matches placeholder names; imports them as their own labelled container', async () => {
    const target = await ensureActiveContext() // target genre is 'Untitled genre'
    const src = await makeSource('Bali notes', 'Untitled genre')
    await upsertEntry(src.ctx, TABLE, 'genre', { text: 'real work under a placeholder' }, 'r__c')

    const counts = await importProjectInto(src.projectId, target.projectId)
    expect(counts.genres).toBe(1)
    const created = (await db.genres.where('project_id').equals(target.projectId).toArray()).find(
      (g) => g.name === 'Untitled genre (Bali notes)',
    )
    expect(created).toBeDefined()
    // The team's own untitled genre was not touched.
    const teamEntries = await db.entries
      .where('project_id')
      .equals(target.projectId)
      .filter((e) => e.genre_id === target.genreId)
      .toArray()
    expect(teamEntries).toHaveLength(0)
  })
})

describe('the append rule', () => {
  it('appends below the team answer with a source marker, exactly once', async () => {
    const target = await ensureActiveContext()
    await upsertEntry(target, SCALAR, 'focusText', { text: 'Team answer.' })
    const src = await makeSource('My worksheet', 'Lullaby', 'Untitled focus text')
    // Same placeholder reference on both sides -> focusTexts merge is blocked by
    // the placeholder rule... so use the real reference the target has.
    const targetFt = await db.focusTexts.get(target.focusTextId)
    await db.focusTexts.update(targetFt!.id, { reference: 'Psalm 13' })
    await db.focusTexts.where('project_id').equals(src.projectId).modify({ reference: 'Psalm 13' })
    await upsertEntry(src.ctx, SCALAR, 'focusText', { text: 'My earlier answer.' })

    const first = await importProjectInto(src.projectId, target.projectId)
    expect(first.appended).toBe(1)
    const merged = await findEntry(target, SCALAR, 'focusText')
    expect(merged?.text).toBe('Team answer.\n\n[From My worksheet] My earlier answer.')

    // Idempotence: a nervous second tap changes nothing.
    const second = await importProjectInto(src.projectId, target.projectId)
    expect(second.appended).toBe(0)
    const again = await findEntry(target, SCALAR, 'focusText')
    expect(again?.text).toBe(merged?.text)
  })

  it('identical answers are recognized, not appended', async () => {
    const target = await ensureActiveContext()
    await db.focusTexts.update(target.focusTextId, { reference: 'Psalm 13' })
    await upsertEntry(target, SCALAR, 'focusText', { text: 'Same words.' })
    const src = await makeSource('Mine', 'Lullaby', 'Psalm 13')
    await upsertEntry(src.ctx, SCALAR, 'focusText', { text: 'Same words.' })

    const counts = await importProjectInto(src.projectId, target.projectId)
    expect(counts.appended).toBe(0)
    const after = await findEntry(target, SCALAR, 'focusText')
    expect(after?.text).toBe('Same words.')
  })

  it('fills an empty team cell and takes values only when the team has none', async () => {
    const target = await ensureActiveContext()
    await db.focusTexts.update(target.focusTextId, { reference: 'Psalm 13' })
    await upsertEntry(target, SCALAR, 'focusText', { text: '', value: 'kept' })
    const src = await makeSource('Mine', 'Lullaby', 'Psalm 13')
    await upsertEntry(src.ctx, SCALAR, 'focusText', { text: 'filled in', value: 'ignored' })

    await importProjectInto(src.projectId, target.projectId)
    const after = await findEntry(target, SCALAR, 'focusText')
    expect(after?.text).toBe('filled in')
    expect(after?.value).toBe('kept')
  })

  it('extends cached translations on append instead of dropping them', async () => {
    const target = await ensureActiveContext()
    await db.focusTexts.update(target.focusTextId, { reference: 'Psalm 13' })
    await upsertEntry(target, SCALAR, 'focusText', { text: 'Team answer.' })
    await upsertEntry(target, SCALAR, 'focusText', { translations: { id: 'Jawaban tim.' } })
    const src = await makeSource('Mine', 'Lullaby', 'Psalm 13')
    await upsertEntry(src.ctx, SCALAR, 'focusText', { text: 'My answer.' })

    await importProjectInto(src.projectId, target.projectId)
    const after = await findEntry(target, SCALAR, 'focusText')
    expect(after?.translations?.id).toBe('Jawaban tim.\n\n[From Mine] My answer.')
  })
})

describe('tables and rows', () => {
  it('unions row order so imported table rows are visible, once', async () => {
    const target = await ensureActiveContext()
    await db.genres.update(target.genreId, { name: 'Lullaby' })
    // The team already has one row.
    await upsertEntry(target, TABLE, 'genre', { value: JSON.stringify(['t-row']) }, ROWS_KEY)
    await upsertEntry(target, TABLE, 'genre', { text: 'team cell' }, 't-row__c1')

    const src = await makeSource('Mine', 'Lullaby')
    await upsertEntry(src.ctx, TABLE, 'genre', { value: JSON.stringify(['s-row']) }, ROWS_KEY)
    await upsertEntry(src.ctx, TABLE, 'genre', { text: 'my cell' }, 's-row__c1')

    await importProjectInto(src.projectId, target.projectId)
    expect(await getRowIds(target, TABLE, 'genre')).toEqual(['t-row', 's-row'])
    const cell = await findEntry(target, TABLE, 'genre', 's-row__c1')
    expect(cell?.text).toBe('my cell')

    // Re-running must not duplicate the row id.
    await importProjectInto(src.projectId, target.projectId)
    expect(await getRowIds(target, TABLE, 'genre')).toEqual(['t-row', 's-row'])
  })
})

describe('safety rails', () => {
  it('dry run counts exactly what the real run does and writes nothing', async () => {
    const target = await ensureActiveContext()
    await db.focusTexts.update(target.focusTextId, { reference: 'Psalm 13' })
    await upsertEntry(target, SCALAR, 'focusText', { text: 'Team answer.' })
    const src = await makeSource('Mine', 'Lament', 'Psalm 13')
    await upsertEntry(src.ctx, SCALAR, 'focusText', { text: 'Different words.' })
    await upsertEntry(src.ctx, TABLE, 'genre', { text: 'table work' }, 'r__c')

    const before = await db.entries.where('project_id').equals(target.projectId).count()
    const preview = await importProjectInto(src.projectId, target.projectId, { dryRun: true })
    expect(await db.entries.where('project_id').equals(target.projectId).count()).toBe(before)
    expect(
      (await db.genres.where('project_id').equals(target.projectId).toArray()).map((g) => g.name),
    ).not.toContain('Lament')

    const real = await importProjectInto(src.projectId, target.projectId)
    expect(real).toEqual(preview)
  })

  it('skips (and counts) entries whose worksheet node no longer exists', async () => {
    const target = await ensureActiveContext()
    await db.focusTexts.update(target.focusTextId, { reference: 'Psalm 13' })
    const src = await makeSource('Mine', 'Lullaby', 'Psalm 13')
    await upsertEntry(src.ctx, 'node.that.never.existed', 'focusText', { text: 'orphan' })

    const counts = await importProjectInto(src.projectId, target.projectId)
    expect(counts.skipped).toBe(1)
    expect(counts.answers).toBe(0)
  })

  it('lists only projects that hold real work, never the team itself', async () => {
    const target = await ensureActiveContext()
    const empty = await makeSource('Empty one')
    const busy = await makeSource('Busy one')
    await upsertEntry(busy.ctx, TABLE, 'genre', { text: 'something' }, 'r__c')

    const sources = await listImportSources(target.projectId)
    expect(sources.map((s) => s.projectId)).toEqual([busy.projectId])
    expect(sources.map((s) => s.projectId)).not.toContain(empty.projectId)
  })
})
