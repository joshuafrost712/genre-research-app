/**
 * Whether the app can tell a person their work is at risk, without crying wolf.
 *
 * Both errors here are costly and they pull in opposite directions. Stay silent
 * and you get the Bali failure: a participant types a session's notes on a phone
 * that was never going to keep them, and nothing says so. Warn too eagerly and
 * you tell a first-time user their work was deleted when they have simply never
 * used the app before, which teaches everyone to ignore the banner by the time it
 * is true.
 *
 * So the loss claim is only ever made against recorded evidence: a high-water
 * mark says work was here, and the device now looks freshly minted. These tests
 * play sessions in sequence against that rule.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { getMetaValue } from '../src/lib/storage/appState'
import { isInAppBrowser, probeSession, recordWorkLevel } from '../src/lib/storage/durability'
import type { Entry } from '../src/lib/types'

const ts = '2026-08-24T11:58:47.000Z'

function entry(id: string, text: string): Entry {
  return {
    id,
    project_id: 'p1',
    node_id: 's1a.inventory',
    cell_key: 'r1',
    text,
    routing_status: 'placed',
    sync_status: 'local',
    created_at: ts,
    updated_at: ts,
  } as Entry
}

async function clearDb() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
}

/** Wipe the data but keep `meta`, which is what an eviction does NOT do... */
async function wipeDataKeepMeta() {
  await db.entries.clear()
  await db.capturedNotes.clear()
  await db.projects.clear()
}

beforeEach(clearDb)

describe('probeSession', () => {
  it('never claims loss on a first-ever session', async () => {
    expect(await probeSession()).toBe(false)
  })

  it('never claims loss for a new user who then types', async () => {
    await probeSession()
    await db.entries.put(entry('e1', 'Laguraket Minahasa'))
    await recordWorkLevel(1)
    // Second session, work still present: nothing was lost.
    expect(await probeSession()).toBe(false)
  })

  it('reports loss when recorded work is gone and the device looks fresh', async () => {
    await probeSession()
    await db.entries.put(entry('e1', 'Laguraket Minahasa'))
    await recordWorkLevel(1)
    await wipeDataKeepMeta()

    expect(await probeSession()).toBe(true)
  })

  it('reports a given loss once, not on every load afterwards', async () => {
    await probeSession()
    await db.entries.put(entry('e1', 'Laguraket Minahasa'))
    await recordWorkLevel(1)
    await wipeDataKeepMeta()

    expect(await probeSession()).toBe(true)
    // The mark reset to what is actually here, so the next load is quiet.
    expect(await probeSession()).toBe(false)
  })

  it('does not claim loss while a project with work is still there', async () => {
    await probeSession()
    await db.projects.put({ id: 'p1', name: 'Minahasa' } as never)
    await db.entries.put(entry('e1', 'Laguraket Minahasa'))
    await recordWorkLevel(1)
    // Only the entry is deleted, and two projects remain: this looks like someone
    // deleting an answer, not a browser emptying the jar.
    await db.projects.put({ id: 'p2', name: 'Toraja' } as never)
    await db.entries.clear()

    expect(await probeSession()).toBe(false)
  })

  it('keeps the high-water mark at its peak across a quiet session', async () => {
    await probeSession()
    await recordWorkLevel(12)
    await recordWorkLevel(3) // a lower reading must not lower the mark
    const raw = await getMetaValue('durabilityProbe')
    expect(JSON.parse(raw ?? '{}').high).toBe(12)
  })

  it('ignores a corrupt probe record instead of throwing', async () => {
    await db.meta.put({ key: 'durabilityProbe', value: '{ truncated' })
    await expect(probeSession()).resolves.toBe(false)
  })
})

describe('isInAppBrowser', () => {
  const SAFARI_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  // WhatsApp, Instagram and friends embed a WKWebView, which drops the Version token.
  const WKWEBVIEW_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
  const CHROME_IOS =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.108 Mobile/15E148 Safari/604.1'
  const CHROME_DESKTOP =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

  it('spots an in-app WKWebView on iOS', () => {
    expect(isInAppBrowser(WKWEBVIEW_IOS)).toBe(true)
  })

  it('leaves real iOS Safari alone', () => {
    expect(isInAppBrowser(SAFARI_IOS)).toBe(false)
  })

  it('does not mistake Chrome on iOS for an in-app browser', () => {
    // Chrome for iOS is also a WKWebView and also omits Version, but it is a
    // browser in its own right; telling its users to "open in Safari" is wrong.
    expect(isInAppBrowser(CHROME_IOS)).toBe(false)
  })

  it('says nothing about desktop browsers', () => {
    expect(isInAppBrowser(CHROME_DESKTOP)).toBe(false)
  })
})
