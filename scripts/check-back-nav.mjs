#!/usr/bin/env node
/**
 * The gate for "we keep losing our way a bit."
 *
 *   npm run dev                          # in another terminal
 *   node scripts/check-back-nav.mjs      # or pass a URL for the deploy
 *
 * Workshop feedback, 2026-08-25: the worksheet moved forwards only. Every section
 * had a Next button and no way back except the sidebar, which on a phone is
 * behind the hamburger — the one place someone who has lost their place will not
 * look. So `SectionNav` puts a back control under the title and a second one
 * beside Next.
 *
 * Two things a unit test cannot say, which is why this drives a real browser:
 *
 * 1. **Painted, not merely rendered.** `innerText` counts text that is covered.
 *    The onboarding gate and the tour are both full-screen overlays, and a back
 *    button underneath one is not a back button. So visibility here is geometric:
 *    find the element, then ask `elementFromPoint` what is actually painted at
 *    its centre (the same lesson as `check-storage-warning.mjs`).
 * 2. **At 390px.** A nav claim checked at 1200px is not a claim about the device
 *    the workshop runs on. The footer holds Home, Back and Next on one phone-width
 *    row, so it is the row most likely to overflow.
 *
 * It also checks the thing that would make back navigation worse than useless:
 * that a keystroke typed a moment before Back is not lost. Answers autosave on a
 * 400ms debounce AND on blur, and the blur is what a tap on Back triggers first.
 * The staged state is a real one — the onboarding gate holds until a project row
 * exists, so the seed creates one.
 */
import { launch, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')
const MARKER = 'back-nav check: typed just before going back'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/** A project row, because the onboarding gate holds the screen until one exists. */
const SEED_PROJECT = `
  const now = new Date().toISOString()
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  await new Promise((res, rej) => {
    const tx = db.transaction(['projects'], 'readwrite')
    tx.objectStore('projects').put({
      id: 'back-nav-project',
      name: 'Back nav check',
      languages: [],
      team_members: [],
      scope: 'narrow',
      config_version: 1,
      is_sensitive: false,
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
 * Close whatever modal is up (the app tour, the worksheet tour).
 * Not a workaround: nobody can use a section without dismissing it first.
 */
const DISMISS_TOUR = `
  const skip = [...document.querySelectorAll('button')].find(
    (b) => ['Skip', 'Done', 'Close'].includes(b.textContent.trim()),
  )
  if (skip) { skip.click(); return 'closed' }
  return 'none'
`

/**
 * Is the control there, painted at its own centre, and where does it point?
 *
 * Scrolls it into view first. `elementFromPoint` is viewport-relative and
 * returns null for anything below the fold, which on a phone is most of a
 * section — so probing without scrolling reports the footer as invisible
 * whether it is covered or not, and tells you nothing either way.
 */
const probe = (selector) => `
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return { found: false }
  el.scrollIntoView({ block: 'center' })
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return { found: true, visible: false, why: 'zero-sized' }
  const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  const covered = !mid || !(el === mid || el.contains(mid) || mid.contains(el))
  return {
    found: true,
    visible: !covered,
    why: covered ? 'covered by ' + (mid ? mid.tagName + '.' + mid.className : 'nothing') : '',
    text: el.innerText.replace(/\\s+/g, ' ').trim(),
    href: el.getAttribute('href'),
    right: r.right,
  }
`

const click = (selector) => `
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  // A tap blurs the focused field before the click lands, and that blur is what
  // flushes a pending keystroke. element.click() alone would skip it and test a
  // sequence no phone produces.
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur()
  }
  el.click()
  return true
`

const TYPE_INTO_FIRST_FIELD = `
  const el = document.querySelector('main textarea, main input[type="text"]')
  if (!el) return { typed: false }
  el.focus()
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(MARKER)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return { typed: true }
`

const SAVED_MARKER_COUNT = `
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('genre-research')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const rows = await new Promise((res, rej) => {
    const all = db.transaction('entries', 'readonly').objectStore('entries').getAll()
    all.onsuccess = () => res(all.result)
    all.onerror = () => rej(all.error)
  })
  db.close()
  return rows.filter((r) => (r.text ?? '').includes(${JSON.stringify(MARKER)})).length
`

const path = () => `return location.pathname`

const browser = await launch('backnav')
try {
  console.log(`\n  ${APP_URL}`)
  await browser.emulate({ width: 390, height: 844 })
  // Without this, headless Chrome fires no blur at all and the autosave check
  // below passes or fails for reasons that have nothing to do with the app.
  await browser.focusEmulation()
  await browser.goto(APP_URL, 3000)
  await browser.evaluate(SEED_PROJECT)
  await browser.goto(APP_URL, 3000)
  await browser.evaluate(DISMISS_TOUR)

  // 1. The start of the journey offers no back control. "Back" from the first
  //    section has no honest answer, and a button that goes nowhere is worse
  //    than none for someone already unsure where they are.
  await browser.goto(`${APP_URL}worksheet/s1a`, 2500)
  await browser.evaluate(DISMISS_TOUR)
  const startTop = await browser.evaluate(probe('[data-section-nav="back-top"]'))
  const startFoot = await browser.evaluate(probe('[data-section-nav="back"]'))
  check('the first section shows no back control', !startTop.found && !startFoot.found)

  // 2. A section mid-journey shows both back controls, painted, on a 390px phone.
  await browser.goto(`${APP_URL}worksheet/s2eth`, 2500)
  await browser.evaluate(DISMISS_TOUR)
  const top = await browser.evaluate(probe('[data-section-nav="back-top"]'))
  check('the back link under the title is painted', top.found && top.visible, top.why || 'missing')
  check(
    'it names the previous section and points at it',
    top.href?.endsWith('/worksheet/s1b') === true,
    `href = ${top.href}, text = "${top.text}"`,
  )
  const foot = await browser.evaluate(probe('[data-section-nav="back"]'))
  check('the footer Back button is painted', foot.found && foot.visible, foot.why || 'missing')
  const next = await browser.evaluate(probe('[data-section-nav="next"]'))
  check(
    'Back and Next both fit inside a 390px screen',
    foot.right <= 390 && next.right <= 390,
    `back right edge ${foot.right}, next right edge ${next.right}`,
  )

  // 3. A keystroke typed a moment before Back is saved, not lost.
  const typed = await browser.evaluate(TYPE_INTO_FIRST_FIELD)
  check('a field was available to type into', typed.typed === true)
  await browser.evaluate(click('[data-section-nav="back"]'))
  await sleep(1200)
  check(
    'Back lands on the previous section',
    (await browser.evaluate(path())).endsWith('/worksheet/s1b'),
    await browser.evaluate(path()),
  )
  check(
    'the keystroke typed just before Back survived',
    (await browser.evaluate(SAVED_MARKER_COUNT)) === 1,
    'the debounced save had not fired, so the blur had to flush it',
  )

  // 4. Back retraces Next exactly, including across the dedicated pages
  //    (2b/2c/2d live on their own routes, not /worksheet/:id).
  await browser.goto(`${APP_URL}macro`, 2500)
  await browser.evaluate(DISMISS_TOUR)
  const macroBack = await browser.evaluate(probe('[data-section-nav="back"]'))
  check(
    'a dedicated page goes back to its own predecessor',
    macroBack.href === '/choose' || macroBack.href?.endsWith('/choose') === true,
    `href = ${macroBack.href}`,
  )
  await browser.evaluate(click('[data-section-nav="back"]'))
  await sleep(1200)
  check(
    'and lands there',
    (await browser.evaluate(path())).endsWith('/choose'),
    await browser.evaluate(path()),
  )

  console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} FAILED`}\n`)
} finally {
  await browser.close()
}

process.exit(failures === 0 ? 0 : 1)
