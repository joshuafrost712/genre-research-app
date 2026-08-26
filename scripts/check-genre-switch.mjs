#!/usr/bin/env node
/**
 * The gate for switching genre without losing your place — or your draft.
 *
 *   npm run dev                            # in another terminal
 *   node scripts/check-genre-switch.mjs    # or pass a URL for the deploy
 *
 * Musicians and cultural insiders do not work one genre at a time: they take one
 * artistic question and move sideways across genres. So the header chip became a
 * pair of switchers that change the active passage × genre in place, leaving the
 * step alone.
 *
 * Four things here that a unit test cannot say. `subsectionCounts` and
 * `subsectionForPath` are pure and live in tests/contextSwitch.test.ts; what
 * follows needs a real React tree, a real router, and a real focused field.
 *
 * 1. **The draft goes where it was typed.** AutosaveText holds keystrokes in
 *    local state and writes them on blur, and its onBlur closure is rebound on
 *    every render. Change the context under a focused, typed-in field and the
 *    blur files the draft under the genre you just switched TO. Silent
 *    cross-genre contamination, and the reason ContextBar blurs first.
 *
 *    This reproduces the Safari shape deliberately: it calls .click() on the row
 *    WITHOUT blurring first, because on Safari tapping a button does not blur a
 *    focused input. A check that blurred first would be testing a sequence the
 *    hazard does not occur in, and would pass whether the fix were present or not.
 *
 * 2. **Focus emulation, or this measures nothing.** Headless Chrome treats every
 *    page as unfocused and fires no blur at all. Without browser.focusEmulation()
 *    the blur() call succeeds, activeElement changes, and no handler ever runs —
 *    so the contamination check passes for a reason that has nothing to do with
 *    the app. Same trap check-back-nav.mjs documents.
 *
 * 3. **The step survives.** The whole point is not going back to question one.
 *    Asserted on /worksheet/:id and on /wizard?step=n, whose index moved into the
 *    URL for exactly this reason.
 *
 * 4. **No duplicate candidate rows.** The switch remounts the page tree, and
 *    ChooseGenre seeds rows from a mount effect guarded by a ref that a remount
 *    destroys. Assertions read IndexedDB, never innerText: a panel rendered under
 *    the header still passes an innerText check.
 */
import { launch, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')
const MARKER = 'genre-switch check: typed and never blurred'

const PROJECT = 'gs-project'
const PASSAGE_A = 'gs-passage-a'
const PASSAGE_B = 'gs-passage-b'
const GENRE_A = 'gs-genre-a'
const GENRE_B = 'gs-genre-b'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/**
 * A project with two passages and two genres, in the shape the app writes.
 *
 * Written straight into IndexedDB because `import('/src/…')` does not exist in a
 * built bundle. Everything downstream — ensureActiveContext, the worksheets it
 * mints, the meta cursors — is the real code. The onboarding gate holds the
 * screen until a project row exists, hence the project.
 */
const SEED = `
  const now = new Date().toISOString()
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const put = (store, row) => new Promise((res, rej) => {
    const tx = db.transaction([store], 'readwrite')
    tx.objectStore(store).put(row)
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  await put('projects', {
    id: ${JSON.stringify(PROJECT)},
    name: 'Genre switch check',
    languages: [], team_members: [], scope: 'narrow',
    config_version: 1, is_sensitive: false,
    created_at: now, updated_at: now,
  })
  for (const [id, reference] of [
    [${JSON.stringify(PASSAGE_A)}, 'Ruth 1:1-5'],
    [${JSON.stringify(PASSAGE_B)}, 'Psalm 13:1-6'],
  ]) {
    await put('focusTexts', {
      id, project_id: ${JSON.stringify(PROJECT)}, reference,
      status: 'active', created_at: now, updated_at: now,
    })
  }
  for (const [id, name] of [
    [${JSON.stringify(GENRE_A)}, 'Aaa lament'],
    [${JSON.stringify(GENRE_B)}, 'Bbb praise song'],
  ]) {
    await put('genres', {
      id, project_id: ${JSON.stringify(PROJECT)}, name,
      is_sensitive: false, created_at: now, updated_at: now,
    })
  }
  db.close()
  return 1
`

/** Close the app tour / worksheet tour. Nobody can use a section behind it. */
const DISMISS_TOUR = `
  const skip = [...document.querySelectorAll('button')].find(
    (b) => ['Skip', 'Done', 'Close'].includes(b.textContent.trim()),
  )
  if (skip) { skip.click(); return 'closed' }
  return 'none'
`

const rows = (store) => `
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const out = await new Promise((res, rej) => {
    const all = db.transaction(${JSON.stringify(store)}, 'readonly')
      .objectStore(${JSON.stringify(store)}).getAll()
    all.onsuccess = () => res(all.result)
    all.onerror = () => rej(all.error)
  })
  db.close()
  return out
`

/** Type without blurring, and leave the caret in the field. */
const TYPE_INTO_FIRST_FIELD = `
  const el = document.querySelector('main textarea, main input[type="text"]')
  if (!el) return { typed: false }
  el.focus()
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(MARKER)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return { typed: true, focused: document.activeElement === el }
`

/**
 * The switcher a person can actually see.
 *
 * Layout mounts ContextBar twice — one hidden below sm, one hidden above it —
 * so `document.querySelector` finds the DESKTOP copy first and, at 390px, that
 * one is display:none. Clicking a hidden button still fires React's handler, so
 * a script that does not scope to the visible instance reports the feature
 * working while never touching the surface the workshop uses.
 */
const VISIBLE_BAR = `
  const bar = [...document.querySelectorAll('[data-context-bar]')]
    .find((el) => el.getBoundingClientRect().width > 0)
`

/** Open a switcher menu (idempotent), and report whether the panel is painted. */
const OPEN = (kind) => `
  ${VISIBLE_BAR}
  if (!bar) return { found: false }
  // Idempotent: the trigger TOGGLES, so clicking it on an already-open menu
  // closes it and the next PICK finds nothing.
  let panel = bar.querySelector('[data-context-panel="${kind}"]')
  if (!panel) {
    const trigger = bar.querySelector('[data-context-switch="${kind}"]')
    if (!trigger) return { found: false }
    trigger.click()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    panel = bar.querySelector('[data-context-panel="${kind}"]')
  }
  if (!panel) return { found: true, open: false }
  const b = panel.getBoundingClientRect()
  const mid = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(12, b.height / 2))
  return {
    found: true,
    open: true,
    painted: !!mid && (panel === mid || panel.contains(mid)),
    why: mid ? mid.tagName + '.' + String(mid.className).slice(0, 40) : 'nothing painted there',
    left: b.left,
    right: b.right,
    rows: panel.querySelectorAll('[data-context-row]').length,
  }
`

/**
 * Click a row WITHOUT blurring first. That is the Safari sequence, and the one
 * the fix exists for; blurring here would test something else entirely.
 */
const PICK = (id) => `
  ${VISIBLE_BAR}
  const row = bar && bar.querySelector('[data-context-row="${id}"]')
  if (!row) return { clicked: false }
  const before = document.activeElement
  const wasStillFocused =
    before instanceof HTMLTextAreaElement || before instanceof HTMLInputElement
  row.click()
  return { clicked: true, wasStillFocused }
`

const where = () => `return location.pathname + location.search`

const browser = await launch('genreswitch')
try {
  console.log(`\n  ${APP_URL}`)
  await browser.emulate({ width: 390, height: 844 })
  // Load-bearing. See (2) in the header comment.
  await browser.focusEmulation()
  await browser.goto(APP_URL, 3000)
  await browser.evaluate(SEED)
  await browser.goto(APP_URL, 3500)
  await browser.evaluate(DISMISS_TOUR)

  // --- the menu itself, on the device the workshop runs on -------------------
  await browser.goto(`${APP_URL}worksheet/s2a`, 2500)
  await browser.evaluate(DISMISS_TOUR)

  const menu = await browser.evaluate(OPEN('genre'))
  check('the genre switcher opens', menu.found && menu.open, JSON.stringify(menu))
  check('its panel is painted, not buried under the header', menu.painted === true, menu.why)
  check('it lists both genres', menu.rows === 2, `${menu.rows} rows`)
  check(
    'the panel fits inside a 390px screen',
    menu.left >= 0 && menu.right <= 390,
    `left ${menu.left}, right ${menu.right}`,
  )

  // --- the draft, and where it lands ----------------------------------------
  // s2a is a genre-layer section, so its answers key off genre_id: exactly the
  // axis being switched, and the one contamination would show up on.
  const before = await browser.evaluate(rows('meta'))
  const activeGenreBefore = before.find((m) => m.key?.includes('activeGenre'))?.value

  const typed = await browser.evaluate(TYPE_INTO_FIRST_FIELD)
  check('a field was available to type into', typed.typed === true)
  check('and it holds focus, so the blur path is the one under test', typed.focused === true)

  const other = activeGenreBefore === GENRE_A ? GENRE_B : GENRE_A
  await browser.evaluate(OPEN('genre'))
  const picked = await browser.evaluate(PICK(other))
  check('the other genre can be picked', picked.clicked === true)
  check(
    'the field was still focused at the moment of the click (the Safari shape)',
    picked.wasStillFocused === true,
    'if this is false the check is not exercising the hazard',
  )
  await sleep(1500)

  const entries = await browser.evaluate(rows('entries'))
  const marked = entries.filter((e) => (e.text ?? '').includes(MARKER))
  check('the draft was saved exactly once', marked.length === 1, `${marked.length} rows carry it`)
  check(
    'the draft belongs to the genre it was typed in, not the one switched to',
    marked.length === 1 && marked[0].genre_id === activeGenreBefore,
    `saved under ${marked[0]?.genre_id}, typed under ${activeGenreBefore}`,
  )

  const afterMeta = await browser.evaluate(rows('meta'))
  check(
    'the active genre really did change',
    afterMeta.find((m) => m.key?.includes('activeGenre'))?.value === other,
  )
  check(
    'and the step is unchanged',
    (await browser.evaluate(where())).includes('/worksheet/s2a'),
    await browser.evaluate(where()),
  )

  // --- the wizard keeps its place too ---------------------------------------
  await browser.goto(`${APP_URL}wizard?step=7`, 2500)
  await browser.evaluate(DISMISS_TOUR)
  await browser.evaluate(OPEN('genre'))
  await browser.evaluate(PICK(activeGenreBefore))
  await sleep(1500)
  check(
    'switching genre inside the wizard holds the step',
    (await browser.evaluate(where())).includes('step=7'),
    await browser.evaluate(where()),
  )

  // --- repeated switching must not duplicate the seeded candidate rows ------
  await browser.goto(`${APP_URL}choose`, 3000)
  await browser.evaluate(DISMISS_TOUR)
  for (const id of [GENRE_B, GENRE_A, GENRE_B, GENRE_A]) {
    await browser.evaluate(OPEN('genre'))
    await browser.evaluate(PICK(id))
    await sleep(1200)
  }
  const after = await browser.evaluate(rows('entries'))
  const names = after.filter(
    (e) => e.node_id === 's0.genre_choice.candidates' && e.cell_key?.endsWith('__name'),
  )
  const perWorksheet = {}
  for (const e of names) {
    const key = `${e.worksheet_id}|${(e.text ?? '').trim().toLowerCase()}`
    perWorksheet[key] = (perWorksheet[key] ?? 0) + 1
  }
  const dupes = Object.entries(perWorksheet).filter(([, n]) => n > 1)
  check(
    'four genre switches on /choose seeded no duplicate candidate rows',
    dupes.length === 0,
    dupes.map(([k, n]) => `${k} ×${n}`).join(', '),
  )

  // --- the passage switcher is wired to the same machinery -------------------
  const passageMenu = await browser.evaluate(OPEN('passage'))
  check('the passage switcher opens too', passageMenu.open === true)
  check('and lists both passages', passageMenu.rows === 2, `${passageMenu.rows} rows`)
  await browser.evaluate(PICK(PASSAGE_B))
  await sleep(1500)
  const metaAfter = await browser.evaluate(rows('meta'))
  check(
    'picking a passage moves the active passage',
    metaAfter.find((m) => m.key?.includes('activeFocusText'))?.value === PASSAGE_B,
  )

  console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} FAILED`}\n`)
} finally {
  await browser.close()
}

process.exit(failures === 0 ? 0 : 1)
