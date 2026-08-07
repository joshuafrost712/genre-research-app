/**
 * The regression these exist for, in Joshua's words: "I just added a Psalm
 * (Psalm 124) in Safari and the passage didn't appear in my Chrome build."
 *
 * Nothing was wrong with replication. Both browsers had signed in, each had
 * published the empty starter project it made for itself, and the old adoption
 * rule bailed out the instant the active project was synced at all — so Chrome
 * pulled Psalm 124 down and went on rendering a different, empty project
 * forever. Every test below is a device pointer question, not a transport one.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { adoptBestProject, switchToProject } from '../src/lib/sync/adopt'
import { hasWork, substanceOf } from '../src/lib/sync/substance'
import { getActiveProjectId, setActiveProject } from '../src/lib/storage/appState'
import type { Entry, FocusText, Genre, Project } from '../src/lib/types'

const T = '2026-08-07T01:00:00.000Z'

async function clearAll() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.entries.clear(),
    db.worksheets.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

/** The shape every device mints for itself on first run, and nothing more. */
async function starter(id: string, updated = T): Promise<string> {
  await db.projects.put({
    id,
    name: 'Untitled project',
    created_at: T,
    updated_at: updated,
  } as Project)
  await db.focusTexts.put({
    id: `${id}-ft`,
    project_id: id,
    reference: 'Untitled focus text',
    created_at: T,
    updated_at: updated,
  } as FocusText)
  await db.genres.put({
    id: `${id}-g`,
    project_id: id,
    name: 'Untitled genre',
    created_at: T,
    updated_at: updated,
  } as Genre)
  return id
}

async function addPassage(projectId: string, reference: string) {
  await db.focusTexts.put({
    id: `${projectId}-${reference}`,
    project_id: projectId,
    reference,
    created_at: T,
    updated_at: T,
  } as FocusText)
}

async function addAnswer(projectId: string, text: string) {
  await db.entries.put({
    id: `${projectId}-${text}`,
    project_id: projectId,
    node_id: 'n1',
    genre_id: `${projectId}-g`,
    text,
    routing_status: 'none',
    sync_status: 'synced',
    created_at: T,
    updated_at: T,
  } as Entry)
}

describe('substance — what counts as work someone did', () => {
  beforeEach(clearAll)

  it('does not count a bare starter, so it never gets published', async () => {
    await starter('p1')
    expect(hasWork(await substanceOf('p1'))).toBe(false)
  })

  it('counts a named passage, because setting tomorrow up is work', async () => {
    // The workshop case: Joshua adds the passages the evening before and types
    // no answers at all. That has to reach his other device.
    await starter('p1')
    await addPassage('p1', 'Psalm 124')
    expect(hasWork(await substanceOf('p1'))).toBe(true)
  })

  it('counts an answer', async () => {
    await starter('p1')
    await addAnswer('p1', 'jawaban')
    expect(hasWork(await substanceOf('p1'))).toBe(true)
  })

  it('ranks answers above passages, so the busiest worksheet wins', async () => {
    await starter('p1')
    await addPassage('p1', 'Psalm 1')
    await addPassage('p1', 'Psalm 2')
    await starter('p2')
    await addAnswer('p2', 'jawaban')
    expect((await substanceOf('p2')).score).toBeGreaterThan((await substanceOf('p1')).score)
  })
})

describe('adoptBestProject — the Safari/Chrome bug', () => {
  beforeEach(clearAll)

  it('moves off an empty starter EVEN WHEN that starter is itself synced', async () => {
    // The exact regression. Chrome published its own empty project, so the old
    // rule saw "already on a synced project" and stopped looking.
    await starter('chrome')
    await starter('safari')
    await addPassage('safari', 'Psalm 124')
    await setActiveProject('chrome')

    const moved = await adoptBestProject('chrome', new Set(['chrome', 'safari']))
    expect(moved).toBe(true)
    expect(await getActiveProjectId()).toBe('safari')
  })

  it('points the container pointers at the adopted project, not just the project', async () => {
    // Adopting the project and leaving activeGenre unset is how a device mints
    // "Untitled genre" INTO someone else's worksheet.
    await starter('chrome')
    await starter('safari')
    await addPassage('safari', 'Psalm 124')
    await adoptBestProject('chrome', new Set(['chrome', 'safari']))
    expect((await db.meta.get('activeGenre:safari'))?.value).toBe('safari-g')
  })

  it('never moves off a project that holds answers', async () => {
    await starter('mine')
    await addAnswer('mine', 'my careful answer')
    await starter('theirs')
    await addAnswer('theirs', 'a')
    await addAnswer('theirs', 'b')
    await setActiveProject('mine')
    expect(await adoptBestProject('mine', new Set(['mine', 'theirs']))).toBe(false)
    expect(await getActiveProjectId()).toBe('mine')
  })

  it('never adopts an empty project, so two blank devices do not swap places', async () => {
    await starter('a')
    await starter('b')
    expect(await adoptBestProject('a', new Set(['a', 'b']))).toBe(false)
  })

  it('does not hop off a worksheet it already shows when a busier one appears', async () => {
    // Joshua sets up seven team worksheets. A device parked on team 3's, with
    // passages but no answers yet, must not be dragged onto team 5's because
    // that one filled up first.
    await starter('team3')
    await addPassage('team3', 'Psalm 124')
    await starter('team5')
    await addPassage('team5', 'Psalm 1')
    await addAnswer('team5', 'lots')
    await setActiveProject('team3')
    expect(await adoptBestProject('team3', new Set(['team3', 'team5']))).toBe(false)
    expect(await getActiveProjectId()).toBe('team3')
  })

  it('is stable: adopting twice changes nothing the second time', async () => {
    await starter('chrome')
    await starter('safari')
    await addPassage('safari', 'Psalm 124')
    expect(await adoptBestProject('chrome', new Set(['chrome', 'safari']))).toBe(true)
    expect(await adoptBestProject('safari', new Set(['chrome', 'safari']))).toBe(false)
  })

  it('leaves a project the person picked by hand alone', async () => {
    // Otherwise setting up an empty worksheet for the next team gets undone by
    // the next three-second poll.
    await starter('blank')
    await starter('busy')
    await addAnswer('busy', 'answers here')
    await switchToProject('blank')
    expect(await adoptBestProject('blank', new Set(['blank', 'busy']))).toBe(false)
    expect(await getActiveProjectId()).toBe('blank')
  })

  it('all devices converge on the same project when scores tie', async () => {
    await starter('aaa')
    await addPassage('aaa', 'Psalm 1')
    await starter('zzz')
    await addPassage('zzz', 'Psalm 1')
    const ids = new Set(['aaa', 'zzz'])
    await starter('deviceA')
    await adoptBestProject('deviceA', ids)
    const first = await getActiveProjectId()
    await db.meta.clear()
    await starter('deviceB')
    await adoptBestProject('deviceB', ids)
    expect(await getActiveProjectId()).toBe(first)
  })
})
