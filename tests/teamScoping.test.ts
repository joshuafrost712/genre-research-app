/**
 * The guarantees behind "am I sure this is going to MY team's data?"
 *
 * Written after the OBT-CDT Psalms workshop, where teams could not tell which
 * worksheet they were in. Two of the three things asserted here were genuinely
 * broken on a device that belongs to more than one team, which is the normal state
 * for a facilitator: the translation queue had no project dimension at all, and
 * every exported row was labelled with whichever passage and genre happened to be
 * open rather than its own.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import {
  cleanProjectName,
  isNamedProject,
  renameProject,
  setActiveProject,
  UNNAMED_PROJECT,
} from '../src/lib/storage/appState'
import { testContext } from './helpers/context'
import { upsertEntry } from '../src/lib/storage/entries'
import { enqueueTranslation, pendingCount, pendingTranslations } from '../src/lib/translate/queue'
import { buildTranslationBundle } from '../src/lib/translate/handoff'
import { buildRows, type ExportNames } from '../src/lib/export'
import type { Entry } from '../src/lib/types'

const NODE = 's0.purpose.general'
const LAYER = 'focusText' as const

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.entries.clear(),
    db.translationQueue.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

/** A second team on the same device: its own project, its own containers. */
async function makeSecondTeam() {
  const first = await testContext()
  const second = crypto.randomUUID()
  await db.projects.put({
    id: second,
    name: 'Other team',
    languages: [],
    team_members: [],
    scope: 'narrow',
    config_version: 1,
    is_sensitive: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  await setActiveProject(second)
  const secondCtx = await testContext()
  return { first, second: secondCtx }
}

describe('a project can be named', () => {
  beforeEach(clearDb)

  it('a new project is born named after its scope, and reads as named', async () => {
    // The onboarding gate composes the name from culture + language, so the
    // Psalms-workshop failure (every team indistinguishable as 'Untitled
    // project') can no longer happen on a fresh install.
    const ctx = await testContext()
    const project = await db.projects.get(ctx.projectId)
    expect(project?.name).toBe('Test culture genres in Test language')
    expect(isNamedProject(project?.name)).toBe(true)
    expect(project?.culture).toBe('Test culture')
    expect(project?.language).toBe('Test language')
  })

  it('the legacy placeholder is still recognised as "not named"', () => {
    // Existing installs still hold pre-gate 'Untitled project' rows; several
    // surfaces (share button, backfill card) key off this check.
    expect(isNamedProject(UNNAMED_PROJECT)).toBe(false)
    expect(isNamedProject('')).toBe(false)
    expect(isNamedProject('Walak team')).toBe(true)
  })

  it('renames, bumps updated_at, and reports itself named', async () => {
    const ctx = await testContext()
    const before = (await db.projects.get(ctx.projectId))!.updated_at

    await renameProject(ctx.projectId, '  Walak   team  ')

    const project = await db.projects.get(ctx.projectId)
    expect(project?.name).toBe('Walak team')
    expect(isNamedProject(project?.name)).toBe(true)
    // Bumped, because last-write-wins compares this: a rename with a stale
    // timestamp loses to whatever the other device last wrote.
    expect(project!.updated_at >= before).toBe(true)
  })

  it('trims, collapses whitespace, and caps the length', () => {
    expect(cleanProjectName('  Tim   Psalms  3 ')).toBe('Tim Psalms 3')
    expect(cleanProjectName('x'.repeat(200))).toHaveLength(80)
    expect(cleanProjectName('   ')).toBe('')
  })

  it('refuses a blank name rather than storing one', async () => {
    const ctx = await testContext()
    await renameProject(ctx.projectId, '   ')
    const project = await db.projects.get(ctx.projectId)
    expect(project?.name).toBe('Test culture genres in Test language')
  })
})

describe('the translation queue belongs to one team', () => {
  beforeEach(clearDb)

  it('excludes another team’s pending work from the count and the bundle', async () => {
    const { first, second } = await makeSecondTeam()

    // Queue one answer in each team.
    await setActiveProject(first.projectId)
    const a = await upsertEntry(first, NODE, LAYER, { text: 'first team answer' })
    await enqueueTranslation({ text: 'first team answer', targetLocale: 'id', entryId: a.id })

    await setActiveProject(second.projectId)
    const b = await upsertEntry(second, NODE, LAYER, { text: 'second team answer' })
    await enqueueTranslation({ text: 'second team answer', targetLocale: 'id', entryId: b.id })

    // Standing in the second team, the first team's work is not ours to see.
    expect(await pendingCount()).toBe(1)
    const bundle = await buildTranslationBundle()
    expect(bundle.count).toBe(1)
    expect(bundle.text).toContain('second team answer')
    // The failure this prevents: another team's answers leaving the device inside
    // a bundle pasted into a Claude session.
    expect(bundle.text).not.toContain('first team answer')

    // Switch back, and the other one is there and the first is not.
    await setActiveProject(first.projectId)
    expect(await pendingCount()).toBe(1)
    const back = await buildTranslationBundle()
    expect(back.text).toContain('first team answer')
    expect(back.text).not.toContain('second team answer')
  })

  it('still drains rows queued before project_id existed', async () => {
    const ctx = await testContext()
    const e = await upsertEntry(ctx, NODE, LAYER, { text: 'queued this morning' })
    // A row from the previous build: no project_id on it at all.
    await db.translationQueue.add({
      entry_id: e.id,
      source_text: 'queued this morning',
      target_locale: 'id',
      status: 'pending',
      attempts: 0,
      created_at: new Date().toISOString(),
    })

    expect(await pendingCount()).toBe(1)
    const rows = await pendingTranslations()
    expect(rows).toHaveLength(1)
  })

  it('stamps the entry’s project, not whichever is active at the time', async () => {
    const { first, second } = await makeSecondTeam()
    await setActiveProject(first.projectId)
    const e = await upsertEntry(first, NODE, LAYER, { text: 'belongs to the first team' })

    // A switch lands between the save and the enqueue.
    await setActiveProject(second.projectId)
    await enqueueTranslation({
      text: 'belongs to the first team',
      targetLocale: 'id',
      entryId: e.id,
    })

    const [row] = await db.translationQueue.toArray()
    expect(row.project_id).toBe(first.projectId)
    // And so it does not show up as the second team's work.
    expect(await pendingCount()).toBe(0)
  })
})

describe('an export names the passage and genre each answer came from', () => {
  const entry = (over: Partial<Entry>): Entry => ({
    id: crypto.randomUUID(),
    project_id: 'p1',
    node_id: NODE,
    cell_key: undefined,
    text: 'an answer',
    updated_at: new Date().toISOString(),
    ...over,
  }) as Entry

  it('labels each row from its own container, not the active one', () => {
    const names: ExportNames = {
      focusText: 'Psalm 13',
      genre: 'Lament',
      mode: 'standard',
      containers: {
        'genre-lament': 'Lament',
        'genre-praise': 'Praise song',
        'ft-13': 'Psalm 13',
        'ft-124': 'Psalm 124',
      },
    }

    const rows = buildRows(
      [
        entry({ genre_id: 'genre-lament' }),
        entry({ genre_id: 'genre-praise' }),
        entry({ focus_text_id: 'ft-124' }),
      ],
      names,
    )

    const containers = rows.map((r) => r.container)
    // The bug: all three used to read "Lament" / "Psalm 13" — whichever pairing
    // was open — so an export of a four-genre team claimed to be one genre.
    expect(containers).toContain('Praise song')
    expect(containers).toContain('Psalm 124')
    expect(containers.filter((c) => c === 'Lament')).toHaveLength(1)
  })

  it('falls back to the active names when no map is supplied', () => {
    const names: ExportNames = { focusText: 'Psalm 13', genre: 'Lament', mode: 'standard' }
    const rows = buildRows([entry({ genre_id: 'genre-praise' })], names)
    expect(rows[0].container).toBe('Lament')
  })
})
