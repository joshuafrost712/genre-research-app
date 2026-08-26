#!/usr/bin/env node
/**
 * The gate for "the account menu is off the right edge of the phone."
 *
 *   npm run dev                                # in another terminal
 *   node scripts/check-header-fits.mjs         # or pass a URL for the deploy
 *
 * Found while checking spec 12 at 390px: the page scrolled sideways by 15px and
 * the account avatar sat past the edge of the screen. Sign out, change password,
 * switch project and "clear this device" were all behind a horizontal scroll
 * nothing on screen hinted at.
 *
 * The cause is worth stating, because it is a shape that recurs: the header's
 * control group was `min-w-0` (shrinkable) while every chip inside it is
 * `shrink-0`. Flexbox shrank the box to 165px against 214px of content, and the
 * shortfall became overflow. A container that promises to shrink and cannot
 * deliver does not clip its children; it spills them.
 *
 * Three things this asserts that a unit test cannot:
 *
 * 1. **Geometry, not innerText.** The avatar was in the DOM and its text was
 *    readable the whole time it was off-screen. So every claim here is a
 *    rectangle compared against the layout viewport.
 * 2. **Painted, not merely positioned.** `elementFromPoint` at the control's own
 *    centre, because an element under a scrim measures identically to a visible
 *    one.
 * 3. **In Indonesian.** This is the case that makes the bug load-bearing rather
 *    than cosmetic: "Sinkronisasi dimatikan" is three times the width of "Sync
 *    off", and the Bali workshop runs in Indonesian. An English-only layout check
 *    would have passed the fix and shipped the bug.
 *
 * It sweeps 16 states: two widths (390px, and the 360px Android common in the
 * field) x two locales x signed in and out x the widest sync label (`?sync=off`)
 * and the ordinary one (`?sync=live`).
 */
import { launch, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')
const REF = process.env.SUPABASE_REF ?? 'ckorlrchryswnnrmuctr'
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/**
 * A session for the signed-in shape. Deliberately fabricated rather than real:
 * this checks a layout, and the avatar renders from the stored user object with
 * no network call. The token is never sent anywhere that would verify it.
 */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
function fakeSession(email) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  const sub = '00000000-0000-4000-8000-000000000abc'
  const jwt = [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({ sub, email, role: 'authenticated', exp, aud: 'authenticated' }),
    'unverified',
  ].join('.')
  return {
    access_token: jwt,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'not-a-real-refresh-token',
    user: {
      id: sub,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date(0).toISOString(),
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
      app_metadata: {},
      user_metadata: {},
      identities: [],
    },
  }
}

/** A project row: the onboarding gate holds the whole screen until one exists. */
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
      id: 'header-fits-project',
      name: 'Header fits check',
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
 * The tour and the onboarding coach marks are full-screen overlays, and one of
 * them over the header is what makes `elementFromPoint` report the control as
 * buried. Take them down the way the person whose header this is would.
 *
 * One click is not enough, and a fixed sleep afterwards is worse. The app tour
 * opens on mount only once `onboarded` has resolved from an async read of the
 * project rows, so it can appear AFTER a dismissal pass has finished and swallow
 * the measurement — which is exactly how the first run of this script reported
 * the account control as buried in four states where nothing was wrong with it.
 * So: click, wait, look again, and require two consecutive clean looks.
 */
const CLEAR_OVERLAYS = `
  const scrim = () => [...document.querySelectorAll('div')].find((el) => {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' || cs.display === 'none') return false
    const r = el.getBoundingClientRect()
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.5
  })
  let clicks = 0, clean = 0
  for (let i = 0; i < 14 && clean < 2; i++) {
    const over = scrim()
    if (!over) { clean++; await new Promise((r) => setTimeout(r, 300)); continue }
    clean = 0
    const b = [...over.querySelectorAll('button')]
      .find((b) => /^(Skip|Got it|Close|Done|Lewati|Selesai|Tutup)$/i.test((b.innerText || '').trim()))
    if (!b) return { cleared: false, clicks, blocking: String(over.className).slice(0, 60) }
    b.click()
    clicks++
    await new Promise((r) => setTimeout(r, 350))
  }
  return { cleared: !scrim(), clicks }
`

const MEASURE = `
  const header = document.querySelector('header')
  if (!header) return { rendered: false }
  const row = header.firstElementChild
  const account = document.querySelector('header [data-account="menu"]')
  // The LAYOUT viewport, not the width we asked for: a classic scrollbar makes
  // documentElement.clientWidth narrower than the device, and every "does it fit"
  // comparison against the device width is then a scrollbar too generous.
  const viewport = document.documentElement.clientWidth
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      left: Math.round(r.left), right: Math.round(r.right),
      w: Math.round(r.width), h: Math.round(r.height),
    }
  }
  const painted = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return null
    const hit = document.elementFromPoint(
      Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return {
      onTop: Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el))),
      topmost: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 30) : null,
    }
  }
  const brand = row.querySelector('a[href]')
  return {
    rendered: true,
    viewport,
    locale: localStorage.getItem('locale'),
    rowOverflow: row.scrollWidth - row.clientWidth,
    pageOverflow: document.documentElement.scrollWidth - viewport,
    account: rect(account),
    accountPainted: painted(account),
    accountText: account ? (account.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24) : null,
    brand: rect(brand),
    brandText: brand ? (brand.innerText || '').trim() : null,
    syncText: (row.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    kids: [...row.children].map((el) => ({
      tag: el.tagName, ...rect(el), sw: el.scrollWidth, cw: el.clientWidth,
    })),
    // Name anything at all that leaves the viewport, so a failure says what to
    // look at instead of "15px somewhere in the page".
    strays: [...document.querySelectorAll('header *')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.right > viewport + 0.5 || r.left < -0.5))
      .slice(0, 6)
      .map(({ el, r }) => ({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 44),
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 20),
        left: Math.round(r.left), right: Math.round(r.right),
      })),
  }
`

const CASES = []
for (const width of [390, 360]) {
  for (const locale of ['en', 'id']) {
    for (const signedIn of [true, false]) {
      // Two sync states, and the pair is the point.
      //
      // `?sync=off` is the widest the header can ever get: it produces the longest
      // label the chip holds, and in Indonesian that is "Sinkronisasi dimatikan",
      // three times the width of "Sync off". It is where the row breaks first.
      //
      // `?sync=live` is the state people are actually in, checked too so the
      // record says what a normal phone looks like rather than only what the worst
      // one does. A fix that fits the extreme by mangling the ordinary case is not
      // a fix.
      //
      // Spelled out rather than left empty, and that is not a stylistic choice.
      // The mode is PERSISTED (lib/sync/mode.ts writes it to meta.syncMode and
      // reads it back when no `?sync=` is present), so a case with no query
      // inherits whatever the case before it asked for. The first version of this
      // list used '' here and every "default" case silently re-measured
      // `?sync=off` — 8 duplicate cases reporting identical widths, and a sweep
      // that looked twice as thorough as it was.
      CASES.push({ width, locale, signedIn, query: '?sync=off' })
      CASES.push({ width, locale, signedIn, query: '?sync=live' })
    }
  }
}

const browser = await launch('headerfits')
try {
  console.log(`\n  ${APP_URL}`)
  // One first load to open IndexedDB and localStorage on the right origin.
  await browser.goto(APP_URL, 2500)
  await browser.evaluate(SEED_PROJECT)

  for (const c of CASES) {
    const who = c.signedIn ? 'signed in' : 'signed out'
    const label = `${c.width}px ${c.locale} ${who} ${c.query}`
    console.log(`\n==> ${c.width}px · ${c.locale} · ${who} · ${c.query}`)
    await browser.emulate({ width: c.width, height: 844, scale: 2 })
    await browser.evaluate(
      `localStorage.setItem('locale', ${JSON.stringify(c.locale)});
       ${
         c.signedIn
           ? `localStorage.setItem(${JSON.stringify(`sb-${REF}-auth-token`)}, ${JSON.stringify(
               JSON.stringify(fakeSession('joshua.frost@example.org')),
             )});`
             // A plain guest, not a device whose session went missing. Dropping the
             // token alone leaves the remembered-email marker behind from the
             // signed-in case before it, which is the "you have been signed out"
             // state — and that modal correctly covers the header, so the paint
             // assertion below would fail on a header with nothing wrong with it.
             // The two produce the same header anyway: one "Sign in" button.
           : `localStorage.removeItem(${JSON.stringify(`sb-${REF}-auth-token`)});
              localStorage.removeItem('genre.lastAccountEmail');
              sessionStorage.removeItem('genre.signedOutAck');`
       }
       return 1`,
    )
    await browser.goto(`${APP_URL}${c.query}`, 3000)
    const up = await browser.until(`Boolean(document.querySelector('header'))`, 20000)
    if (!up.ok) {
      check(`the header renders at ${c.width}px (${c.locale}, ${who})`, false, 'no <header> after 20s')
      continue
    }
    const cleared = await browser.evaluate(CLEAR_OVERLAYS)
    check(
      `${label}: the header is not under an overlay that cannot be dismissed`,
      cleared.cleared === true,
      `${cleared.clicks} dismissals, still blocked by ${cleared.blocking}`,
    )
    await sleep(400)
    const m = await browser.evaluate(MEASURE)

    console.log(`    row: "${m.syncText}"`)
    console.log(`    kids: ${JSON.stringify(m.kids)}`)

    check(
      `${label}: the top header row does not overflow (${m.rowOverflow}px)`,
      m.rowOverflow <= 1,
      `${m.rowOverflow}px of content past the row; strays ${JSON.stringify(m.strays)}`,
    )
    check(
      `${label}: the page does not scroll sideways (${m.pageOverflow}px)`,
      m.pageOverflow <= 1,
      `${m.pageOverflow}px; strays ${JSON.stringify(m.strays)}`,
    )
    check(
      `${label}: the account control is inside the ${m.viewport}px viewport`,
      Boolean(m.account) &&
        m.account.left >= 0 &&
        m.account.right <= m.viewport &&
        m.account.w > 0 &&
        m.account.h > 0,
      `rect ${JSON.stringify(m.account)} — "${m.accountText}"`,
    )
    check(
      `${label}: the account control is painted, not buried`,
      m.accountPainted?.onTop === true,
      `topmost at its centre is ${m.accountPainted?.topmost}`,
    )
    // The brand is the element deliberately sacrificed for space, so it is
    // allowed to be narrow — but not to vanish. It is the only way home from a
    // phone header once the drawer is closed.
    check(
      `${label}: the brand link keeps a tappable width (${m.brand?.w}px, "${m.brandText}")`,
      Boolean(m.brand) && m.brand.w >= 24,
      JSON.stringify(m.brand),
    )
    // A number that says "0px of overflow" is not the same as a header somebody
    // would want to look at. Leave the evidence on disk either way.
    const shot = `${SHOT_DIR}/header-${c.width}-${c.locale}-${c.signedIn ? "in" : "out"}-${c.query.replace(/\W/g, "")}.png`
    await browser.screenshot(shot)
    console.log(`    shot: ${shot}`)
  }
} finally {
  await browser.close()
}

console.log(`\n  ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
