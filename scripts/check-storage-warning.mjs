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
 */
import { launch } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const skip = (name, why) => console.log(`    skip ${name} — ${why}`)

const BODY_TEXT = `return document.body.innerText.replace(/\\s+/g, ' ')`

/**
 * Put one answer into the app's IndexedDB directly.
 *
 * Opened WITHOUT a version so it attaches to whatever Dexie has already created;
 * naming a version here would trigger an upgrade against a schema this script
 * does not own.
 */
const ADD_ENTRY = `
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction('entries', 'readwrite')
    tx.objectStore('entries').put({
      id: 'check-entry-1',
      project_id: 'check-project',
      node_id: 's1a.inventory',
      cell_key: 'r1',
      text: 'Laguraket Minahasa is an Indonesian music genre.',
      routing_status: 'placed',
      sync_status: 'local',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  db.close()
  return 1
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
  const emptyText = await browser.evaluate(BODY_TEXT)
  check(
    'a guest who has typed nothing is not warned',
    !/may delete it/i.test(emptyText),
    'the at-risk banner showed with no work on the device',
  )

  // 1 + 3. A guest with work, on a browser that refused to promise.
  await browser.evaluate(ADD_ENTRY)
  await browser.goto(APP_URL, 3500)
  const workedText = await browser.evaluate(BODY_TEXT)

  if (persisted === true) {
    skip(
      'a guest with work on an unprotected browser is warned',
      'this browser granted persistent storage, so the at-risk state cannot be staged here',
    )
  } else {
    check(
      'a guest with work on an unprotected browser is warned',
      /saved on this phone only/i.test(workedText),
      'no at-risk warning for a guest holding unsaved work',
    )
    check(
      'the warning offers a backup, not only a sign-in',
      /save backup/i.test(workedText),
      'no "Save backup" action in the warning',
    )
    check(
      'the page still works underneath it',
      /export|passages|genres/i.test(workedText),
      'the banner appears to have replaced the page rather than sitting above it',
    )

    // 4. Layout: the banner must sit above the app, not over it.
    const layout = await browser.evaluate(`
      const doc = document.documentElement
      return {
        overflowX: doc.scrollWidth > doc.clientWidth + 1,
        headerVisible: !!document.querySelector('header'),
      }
    `)
    check(
      'no horizontal overflow at 390px',
      !layout.overflowX,
      'the banner pushed the page wider than the viewport',
    )
    check('the header is still on screen', layout.headerVisible)
  }

  await browser.screenshot('/tmp/storage-warning-390.png', { fullPage: false })
  console.log('    (screenshot: /tmp/storage-warning-390.png)')

  await browser.evaluate(CLEAR_WORK)
} finally {
  await browser.close?.()
}

console.log(failures === 0 ? '\n  all checks passed\n' : `\n  ${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
