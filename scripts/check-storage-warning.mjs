#!/usr/bin/env node
/**
 * The gate for "nobody told me this browser might delete my work."
 *
 *   npm run dev                                     # in another terminal
 *   node scripts/check-storage-warning.mjs          # or pass a URL for the deploy
 *
 * On 2026-08-24 a Bali workshop participant opened the app from a chat link on an
 * iPhone, typed a session of notes on local music genres, and then found the app
 * empty. The app was not short of the fact: `persist.ts` had asked the browser to
 * keep the data and been refused, and the refusal was rendered only inside the
 * SIGNED-IN account menu — the one place a guest can never look.
 *
 * A unit test cannot catch the regression, for the same reason
 * `check-signed-out-visible.mjs` exists: the failure is a component rendering
 * NOTHING, which every green assertion about the rest of the app is compatible
 * with. So this asserts against the real DOM:
 *
 *   1. a guest with work on an unprotected browser is warned, and offered a backup;
 *   2. a guest who has typed nothing is NOT warned (a warning about losing work
 *      you have not done is noise, and noise is what gets a banner ignored);
 *   3. the warning survives a reload, because the risk does;
 *   4. it fits a 390px phone without covering the page.
 *
 * If the browser running this actually grants persistent storage, test 1 cannot
 * be staged and says so rather than passing vacuously.
 *
 * ## Two things this got wrong first, both worth keeping in mind
 *
 * **Presence is not visibility.** The first version asserted on
 * `document.body.innerText`, which counts text that is rendered but covered. When
 * the onboarding gate landed — a full-screen overlay — every assertion still
 * passed while the banner sat invisible underneath it. So the visibility check is
 * now geometric: find the element, then ask `elementFromPoint` what is actually
 * painted at its centre. That is the same class of mistake the whole file exists
 * to catch, one layer up.
 *
 * **The staged state has to be one a real person can reach.** Seeding an answer
 * with no project row put the app in a state no guest can occupy (the onboarding
 * gate holds until a project exists) and quietly tested that instead. The seed
 * now creates the project too.
 */
import { launch, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const skip = (name, why) => console.log(`    skip ${name} — ${why}`)



/**
 * Put one answer into the app's IndexedDB directly.
 *
 * Opened WITHOUT a version so it attaches to whatever Dexie has already created;
 * naming a version here would trigger an upgrade against a schema this script
 * does not own.
 */
const ADD_ENTRY = `
  const now = new Date().toISOString()
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['projects', 'entries'], 'readwrite')
    // The project row matters: the onboarding gate holds the screen until one
    // exists, so an answer without it stages a state no guest can be in.
    tx.objectStore('projects').put({
      id: 'check-project',
      name: 'Storage check',
      languages: [],
      team_members: [],
      scope: 'narrow',
      config_version: 1,
      is_sensitive: false,
      created_at: now,
      updated_at: now,
    })
    tx.objectStore('entries').put({
      id: 'check-entry-1',
      project_id: 'check-project',
      node_id: 's1a.inventory',
      cell_key: 'r1',
      text: 'Laguraket Minahasa is an Indonesian music genre.',
      routing_status: 'placed',
      sync_status: 'local',
      created_at: now,
      updated_at: now,
    })
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return 1
`

/**
 * Is the banner actually painted where it claims to be?
 *
 * Returns the visible text only when the element exists, has a real box, and is
 * what `elementFromPoint` finds at its own centre. An overlay covering it fails
 * the last condition, which is exactly the case that slipped through before.
 */
const VISIBLE_WARNING = `
  const el = document.querySelector('[data-storage-warning]')
  if (!el) return { found: false }
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return { found: true, visible: false, why: 'zero-sized' }
  const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  const covered = !mid || !(el === mid || el.contains(mid))
  return {
    found: true,
    visible: !covered,
    why: covered ? 'covered by ' + (mid ? mid.tagName + '.' + mid.className : 'nothing') : '',
    text: el.innerText.replace(/\\s+/g, ' '),
    top: r.top,
  }
`

/**
 * Dismiss the app tour, as a person does before they can type anything.
 *
 * Not a workaround for a bug. The tour is a modal that auto-opens once while
 * unseen, so it legitimately covers the banner — and nobody can answer a
 * worksheet question without closing it first. Seeding an answer straight into
 * IndexedDB skips that step and manufactures an overlap a real guest never sees.
 * Closing it here restores the real sequence: tour, then work, then the warning.
 */
const DISMISS_TOUR = `
  const skip = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Skip',
  )
  if (skip) { skip.click(); return 'closed' }
  return 'none'
`

const CLEAR_WORK = `
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['entries', 'capturedNotes'], 'readwrite')
    tx.objectStore('entries').clear()
    tx.objectStore('capturedNotes').clear()
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return 1
`

const browser = await launch('storagewarn')
try {
  console.log(`\n  ${APP_URL}`)
  await browser.emulate({ width: 390, height: 844 })
  await browser.goto(APP_URL, 3500)

  const persisted = await browser.evaluate(
    `return navigator.storage?.persisted ? await navigator.storage.persisted() : 'unsupported'`,
  )
  console.log(`    (navigator.storage.persisted() = ${persisted})`)

  // 2. A guest who has typed nothing.
  await browser.evaluate(CLEAR_WORK)
  await browser.goto(APP_URL, 3500)
  const empty = await browser.evaluate(VISIBLE_WARNING)
  check(
    'a guest who has typed nothing is not warned',
    !empty.found,
    'the at-risk banner rendered with no work on the device',
  )

  // 1 + 3. A guest with work, on a browser that refused to promise.
  await browser.evaluate(ADD_ENTRY)
  await browser.goto(APP_URL, 3500)
  const tour = await browser.evaluate(DISMISS_TOUR)
  if (tour === 'closed') await sleep(600)
  const warn = await browser.evaluate(VISIBLE_WARNING)

  if (persisted === true) {
    skip(
      'a guest with work on an unprotected browser is warned',
      'this browser granted persistent storage, so the at-risk state cannot be staged here',
    )
  } else {
    check(
      'a guest with work on an unprotected browser is warned',
      warn.found,
      'no at-risk banner rendered for a guest holding unsaved work',
    )
    check(
      'the warning is actually visible, not covered by an overlay',
      warn.found && warn.visible,
      warn.why,
    )
    check(
      'the warning says what is at stake',
      /saved on this phone only/i.test(warn.text ?? ''),
      'the banner is up but does not name the risk',
    )
    check(
      'the warning offers a backup, not only a sign-in',
      /save backup/i.test(warn.text ?? ''),
      'no "Save backup" action in the warning',
    )

    // 4. Layout: the banner must sit above the app, not over it.
    const layout = await browser.evaluate(`
      const doc = document.documentElement
      const header = document.querySelector('header')
      const banner = document.querySelector('[data-storage-warning]')
      return {
        overflowX: doc.scrollWidth > doc.clientWidth + 1,
        headerTop: header ? header.getBoundingClientRect().top : -1,
        bannerBottom: banner ? banner.getBoundingClientRect().bottom : -1,
        pageText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400),
      }
    `)
    check(
      'no horizontal overflow at 390px',
      !layout.overflowX,
      'the banner pushed the page wider than the viewport',
    )
    check(
      'it pushes the header down rather than sitting on top of it',
      layout.headerTop >= layout.bannerBottom - 1,
      `header top ${layout.headerTop} vs banner bottom ${layout.bannerBottom}`,
    )
    check(
      'the app is underneath it, not replaced by it',
      /export|passages|genres|workspace/i.test(layout.pageText),
      'no app chrome found below the banner',
    )
  }

  await browser.screenshot('/tmp/storage-warning-390.png', { fullPage: false })
  console.log('    (screenshot: /tmp/storage-warning-390.png)')

  await browser.evaluate(CLEAR_WORK)
} finally {
  await browser.close?.()
}

console.log(failures === 0 ? '\n  all checks passed\n' : `\n  ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
