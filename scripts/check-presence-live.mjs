#!/usr/bin/env node
/**
 * Spec 12's browser half: what two real people see when they share a worksheet.
 *
 *   scripts/preview-build.sh --with-unconfigured               # terminal 1
 *   UNCONFIGURED_URL=http://localhost:4174/genre-research-app/ \
 *     node scripts/check-presence-live.mjs http://localhost:4173/genre-research-app/
 *
 * `verify-presence.mjs` already proves the data: a member is seen, a stranger is
 * refused, a closed tab disappears. None of that says the dot RENDERS, that it
 * renders on the right tab, that the header reads sensibly beside TeamChip, or
 * that the whole feature stays out of the way when it is switched off. Those are
 * the four things nobody could check from a terminal, and they are this script.
 *
 * Two rules it is written around:
 *
 * 1. ABSENCE IS NOT A RESULT unless something positive is asserted beside it.
 *    "No dots appeared" is what `?sync=poll` should look like, and it is also
 *    what a feature that silently fails to boot looks like. So every negative
 *    here is paired: no presence UI *and* no realtime socket was opened, checked
 *    against a run in the same script where both did happen.
 * 2. LAYOUT CLAIMS ARE GEOMETRIC. `innerText` reads an element that is clipped,
 *    overlapped or pushed off-screen exactly as it reads a visible one, so the
 *    390px check measures rectangles and writes a PNG to look at.
 */
import { launch, accounts, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:4173/genre-research-app/').replace(/\/?$/, '/')
const REF = process.env.PROJECT_REF ?? 'ckorlrchryswnnrmuctr'
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN required (source ~/.claude/secrets/supabase.env).')
  process.exit(1)
}
/** A second origin serving a build with no VITE_SUPABASE_* set. Optional. */
const UNCONFIGURED_URL = process.env.UNCONFIGURED_URL
  ? process.env.UNCONFIGURED_URL.replace(/\/?$/, '/')
  : null

const SHOTS = process.env.SHOT_DIR ?? '/tmp'
const REALTIME = /\/realtime\/v1\/websocket/

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/**
 * Is this error just GitHub Pages not knowing about a client-side route?
 *
 * Pages has no SPA rewrite, so `…/teams` and `…/worksheet/<id>` are answered with
 * HTTP 404 and the repo's `404.html`, which boots the same app — the page works,
 * and the browser still logs the status as an error. Run against `vite preview`
 * the same navigations are 200, which is why this only ever appears on the deploy.
 *
 * Narrow on purpose. A 404 for a path with a FILE EXTENSION is a missing asset and
 * still fails the run; only extension-less paths, which are routes, are excused.
 * Blanket-ignoring 404s would have hidden a missing icon or a dead chunk.
 */
const isPagesRoute404 = (message) => {
  if (!/status of 404/.test(message)) return false
  const url = /\[(https?:\/\/[^\]]+)\]/.exec(message)?.[1]
  if (!url) return false
  try {
    return !/\.[a-z0-9]+$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** Presence dots in the desktop sidebar, each tied to the link it sits inside. */
const sidebarDots = (page) =>
  page.evaluate(`
    const side = document.querySelector('aside')
    if (!side) return null
    const out = []
    for (const el of side.querySelectorAll('[data-presence="dot"]')) {
      const title = el.getAttribute('title') || ''
      const a = el.closest('a')
      out.push({ title, href: a ? a.getAttribute('href') : null, label: a ? (a.innerText || '').trim() : null })
    }
    return out
  `)

/** The header's presence chip text, or null when it is not rendered. */
const headerChip = (page) =>
  page.evaluate(`
    const el = document.querySelector('header [data-presence="chip"]')
    return el ? { text: (el.innerText || '').trim(), title: el.getAttribute('title') } : null
  `)

/**
 * Wait for a dot to appear in the sidebar, and say how long it took.
 *
 * Polled rather than read once, and the reason is the whole newcomer problem:
 * broadcast keeps no history, so somebody who joins after a peer last moved
 * learns where that peer is only when the peer re-announces. That is a round
 * trip after the join, not something already on screen when the header count
 * updates — the count comes from presence, which the server hands over at once.
 * Reading immediately measured the race, not the feature.
 */
const untilDot = (page, timeoutMs = 15000) =>
  page.until(
    `(() => {
        const side = document.querySelector('aside')
        if (!side) return null
        const el = side.querySelector('[data-presence="dot"]')
        if (!el) return null
        const a = el.closest('a')
        return { title: el.getAttribute('title'), href: a ? a.getAttribute('href') : null }
      })()`,
    timeoutMs,
    200,
  )

/** Every worksheet link the sidebar is currently offering. */
const navHrefs = (page) =>
  page.evaluate(`
    const side = document.querySelector('aside')
    if (!side) return []
    return [...side.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => h && h.includes('/worksheet/'))
  `)

/** Click a sidebar link, so the route changes the way it does for a person. */
const clickNav = (page, href) =>
  page.evaluate(`
    const side = document.querySelector('aside') || document
    const a = [...side.querySelectorAll('a[href]')].find(x => x.getAttribute('href') === ${JSON.stringify(href)})
    if (!a) return 'not-found'
    a.click()
    return 'clicked'
  `)

const clickButton = (page, pattern, scope = 'main') =>
  page.evaluate(`
    const root = document.querySelector(${JSON.stringify(scope)}) || document
    const el = [...root.querySelectorAll('button')].find(b => ${pattern}.test(b.textContent || ''))
    if (!el) return 'not-found'
    el.click()
    return 'clicked'
  `)

/** Walk the first-run gate the way a person with solo work would. */
const passGate = async (page, culture, language) => {
  const up = await page.until(`Boolean(document.querySelector('[data-onboarding-gate]'))`, 8000)
  if (!up.ok) return 'no-gate'
  const chose = await page.evaluate(`
    const root = document.querySelector('[data-onboarding-gate]')
    const btn = [...root.querySelectorAll('button')].find(b => /Start a new project/i.test(b.textContent || ''))
    if (!btn) return 'no-start-choice'
    btn.click()
    return 'chose'
  `)
  if (chose !== 'chose') return chose
  const filled = await page.evaluate(`
    const root = document.querySelector('[data-onboarding-gate]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const fill = (id, v) => {
      const input = root.querySelector('#' + id)
      if (!input) return false
      setter.call(input, v)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    if (!fill('onboard-culture', ${JSON.stringify(culture)})) return 'no-culture-field'
    if (!fill('onboard-language', ${JSON.stringify(language)})) return 'no-language-field'
    const start = [...root.querySelectorAll('button')].find(b => /^Start$/.test((b.textContent || '').trim()))
    if (!start || start.disabled) return 'start-unavailable'
    start.click()
    return 'submitted'
  `)
  if (filled !== 'submitted') return filled
  const gone = await page.until(`!document.querySelector('[data-onboarding-gate]')`, 8000)
  return gone.ok ? 'passed' : 'gate-stuck'
}

/** Does this browser hold an entry with this text yet? */
const hasEntry = (page, text) =>
  page.until(
    `(await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onerror = () => resolve(0)
        req.onsuccess = () => {
          const dbh = req.result
          if (!dbh.objectStoreNames.contains('entries')) return resolve(0)
          const all = dbh.transaction('entries','readonly').objectStore('entries').getAll()
          all.onsuccess = () => resolve(all.result.filter(e => e.text === ${JSON.stringify(text)}).length)
          all.onerror = () => resolve(0)
        }
      })) > 0`,
    25000,
  )

const acc = await accounts(REF, PAT)
const stamp = Date.now().toString(36)
// The uniqueness stamp lives in the DOMAIN: personLabel() reads the local part
// and hands back the raw address when it contains anything but plain words, so a
// stamped local part would make this a test of the fallback, not of the name.
const HOST_EMAIL = `ana.dewi@t${stamp}.example.com`
const GUEST_EMAIL = `budi.santoso@t${stamp}.example.com`
const HOST_NAME = 'Ana Dewi'
const GUEST_NAME = 'Budi Santoso'

const PROJECT_ID = crypto.randomUUID()
const nowIso = new Date().toISOString()
const ANSWER = `Jawaban awal ${stamp}`
const LATER = `Jawaban susulan ${stamp}`

console.log(`==> App ${APP_URL}`)

let host, guest, lonely, unconfigured
try {
  const hostUser = await acc.create('preshost', { email: HOST_EMAIL })
  const guestUser = await acc.create('presguest', { email: GUEST_EMAIL })
  console.log(`==> ${HOST_NAME} <${hostUser.email}> shares; ${GUEST_NAME} <${guestUser.email}> joins`)

  const rec = (tbl, id, data, at = nowIso) => ({
    tbl,
    record_id: id,
    op: 'upsert',
    updated_at: at,
    author_id: 'seed',
    data,
  })
  await acc.rest(hostUser, '/rpc/create_shared_project', {
    method: 'POST',
    body: JSON.stringify({ p_project: PROJECT_ID, p_name: `Presence check ${stamp}` }),
  })
  await acc.rest(hostUser, '/rpc/push_records', {
    method: 'POST',
    body: JSON.stringify({
      p_project: PROJECT_ID,
      p_records: [
        rec('projects', PROJECT_ID, {
          id: PROJECT_ID,
          name: `Presence check ${stamp}`,
          languages: ['id'],
          team_members: [],
          scope: 'narrow',
          config_version: 1,
          is_sensitive: false,
          created_at: nowIso,
          updated_at: nowIso,
        }),
        rec('genres', 'seed-genre', {
          id: 'seed-genre',
          project_id: PROJECT_ID,
          name: 'Kidung ratapan',
          created_at: nowIso,
          updated_at: nowIso,
        }),
        rec('entries', `seed-entry-${stamp}`, {
          id: `seed-entry-${stamp}`,
          project_id: PROJECT_ID,
          node_id: '1a',
          genre_id: 'seed-genre',
          cell_key: 'c1',
          text: ANSWER,
          source_language: 'id',
          routing_status: 'none',
          sync_status: 'synced',
          created_at: nowIso,
          updated_at: nowIso,
        }),
      ],
    }),
  })

  host = await launch('preshost')
  guest = await launch('presguest')
  // A laptop, because the sidebar this feature draws into is `lg:block` and a
  // headless window defaults to 800px — below the breakpoint. Checked at the
  // default size, every dot assertion would fail against a sidebar that is not
  // in the document at all, and read as a broken feature.
  await host.emulate({ width: 1280, height: 900, scale: 1 })
  await guest.emulate({ width: 1280, height: 900, scale: 1 })
  const hostSockets = await host.watchSockets()
  const hostErrors = await host.watchErrors()

  // --- both devices onto one worksheet --------------------------------------
  console.log('==> Both sign in and land on the shared worksheet')
  await host.goto(APP_URL)
  await host.signIn(REF, hostUser.session)
  await host.goto(APP_URL, 3000)
  await host.until(`Boolean(document.querySelector('main'))`, 20000)
  const hostReady = await host.until(`!document.querySelector('[data-onboarding-gate]')`, 25000)
  check(`the host's pulled project dismisses the first-run gate (${hostReady.ms}ms)`, hostReady.ok)

  await host.goto(`${APP_URL}teams`, 5000)
  const codeShown = await host.until(
    `(() => { const m = document.body.innerText.match(/[a-z]+-[a-z]+-[a-z]+-\\d{3}/); return m ? m[0] : null })()`,
    25000,
  )
  check('the join code is on the host page', codeShown.ok, `not found in ${codeShown.ms}ms`)
  const code = codeShown.value

  await guest.goto(APP_URL)
  await guest.signIn(REF, guestUser.session)
  await guest.goto(APP_URL, 3000)
  const gateResult = await passGate(guest, 'Budaya penerjemah', 'Bahasa uji')
  check(
    'the guest passes the first-run gate',
    gateResult === 'passed' || gateResult === 'no-gate',
    String(gateResult),
  )
  await guest.goto(`${APP_URL}teams`, 5000)
  const typed = await guest.evaluate(`
    const input = [...(document.querySelector('main') || document).querySelectorAll('input')]
      .find(i => /summit|code/i.test(i.placeholder || ''))
    if (!input) return 'no-input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(code)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  `)
  check('the guest can type the code', typed === code, String(typed))
  const joined = await clickButton(guest, '/^Join/')
  check('the Join button works', joined === 'clicked', String(joined))
  const arrived = await hasEntry(guest, ANSWER)
  check(`the guest receives the shared worksheet (${arrived.ms}ms)`, arrived.ok, 'not within 25s')

  // --- 1. two people, two sections ------------------------------------------
  console.log('\n==> CHECK 1 — a dot with the other person\'s name, on their section')
  await host.goto(`${APP_URL}`, 4000)
  const hrefs = await navHrefs(host)
  check('the sidebar offers worksheet links to sit on', hrefs.length >= 3, `${hrefs.length} links`)
  // First and last, so the two people are in different nav groups: a group row
  // aggregates its children, so two neighbours would put a legitimate dot on a
  // shared ancestor and blur what the per-tab assertions below mean.
  const HOST_HREF = hrefs[0]
  const GUEST_HREF = hrefs[hrefs.length - 1]
  const MOVED_HREF = hrefs[hrefs.length - 2]
  console.log(`    host sits on ${HOST_HREF}; guest on ${GUEST_HREF}`)

  await host.goto(`${APP_URL.replace(/\/$/, '')}${HOST_HREF.replace(/^\/genre-research-app/, '')}`, 3000)
  await guest.goto(`${APP_URL.replace(/\/$/, '')}${GUEST_HREF.replace(/^\/genre-research-app/, '')}`, 3000)

  const hostSeesChip = await host.until(
    `(() => { const e = document.querySelector('header [data-presence="chip"]'); return e ? e.innerText.trim() : null })()`,
    30000,
    250,
  )
  check(
    `the host header reads "1 here now" (${hostSeesChip.ms}ms)`,
    hostSeesChip.value === '1 here now',
    JSON.stringify(hostSeesChip.value),
  )
  const hostChip = await headerChip(host)
  check(
    `and names the guest in its title (${JSON.stringify(hostChip?.title)})`,
    (hostChip?.title ?? '').includes(GUEST_NAME),
    `expected ${GUEST_NAME}`,
  )
  check(
    'a realtime channel was actually opened',
    hostSockets.matching(REALTIME).length > 0,
    `sockets: ${JSON.stringify(hostSockets.all())}`,
  )

  const hostDot = await untilDot(host)
  check(`the host sees a dot in the sidebar (${hostDot.ms}ms)`, hostDot.ok, 'none within 15s')
  const hostDots = await sidebarDots(host)
  check(`the host sees exactly one`, hostDots?.length === 1, JSON.stringify(hostDots))
  check(
    `and it is on the guest's section (${hostDots?.[0]?.href})`,
    hostDots?.[0]?.href === GUEST_HREF,
    `expected ${GUEST_HREF}`,
  )
  check(
    `and it names the guest (${JSON.stringify(hostDots?.[0]?.title)})`,
    (hostDots?.[0]?.title ?? '').includes(GUEST_NAME),
    `expected ${GUEST_NAME}`,
  )
  check(
    'the host never sees a dot on their own section',
    !hostDots?.some((d) => d.href === HOST_HREF),
    JSON.stringify(hostDots),
  )

  const guestSeesChip = await guest.until(
    `(() => { const e = document.querySelector('header [data-presence="chip"]'); return e ? e.innerText.trim() : null })()`,
    30000,
    250,
  )
  check(
    `the guest header reads "1 here now" (${guestSeesChip.ms}ms)`,
    guestSeesChip.value === '1 here now',
    JSON.stringify(guestSeesChip.value),
  )
  // The guest joined LAST, so this is the newcomer case: the host has to notice
  // the arrival and re-announce before the guest can know where it is. That is a
  // round trip, and it is the one thing the presence-only design got for free.
  const guestDot = await untilDot(guest)
  check(
    `the newcomer learns where the host is, unprompted (${guestDot.ms}ms)`,
    guestDot.ok,
    'no dot within 15s — the re-announce-on-join is not firing',
  )
  const guestDots = await sidebarDots(guest)
  check(
    `the guest sees one dot, on the host's section (${guestDots?.[0]?.href})`,
    guestDots?.length === 1 && guestDots[0].href === HOST_HREF,
    JSON.stringify(guestDots),
  )
  check(
    `and it names the host (${JSON.stringify(guestDots?.[0]?.title)})`,
    (guestDots?.[0]?.title ?? '').includes(HOST_NAME),
    `expected ${HOST_NAME}`,
  )

  // --- the dot follows a navigation, EVERY time -----------------------------
  //
  // Walked repeatedly, not once, and that is the point of this block rather than
  // thoroughness for its own sake. The first build of this feature sent node
  // changes over PRESENCE, and Realtime's per-client presence rate limit does not
  // shed the event — it closes the channel. The dot followed four moves and then
  // froze for the rest of the session, silently, because an empty room and a dead
  // channel look identical. So the interesting question was never whether the
  // first move lands.
  //
  // TWELVE, deliberately more than the five that used to pass. A regression here
  // would put the hot path back on presence, and a five-step walk is exactly the
  // length that cannot tell the difference.
  console.log('\n==> The guest walks the nav; the host\'s dot should follow every time')
  const walk = Array.from({ length: 12 }, (_, i) => (i % 2 ? GUEST_HREF : MOVED_HREF))
  const timings = []
  for (const [i, target] of walk.entries()) {
    const moved = await clickNav(guest, target)
    if (moved !== 'clicked') {
      check(`walk ${i + 1}: the guest can click through the nav`, false, String(moved))
      break
    }
    const followed = await host.until(
      `(() => {
          const side = document.querySelector('aside')
          if (!side) return null
          const el = side.querySelector('[data-presence="dot"]')
          const a = el && el.closest('a')
          return a ? a.getAttribute('href') : null
        })() === ${JSON.stringify(target)}`,
      12000,
      100,
    )
    timings.push(followed.ok ? followed.ms : null)
    check(
      `walk ${i + 1}: the dot reaches ${target.split('/').pop()} (${followed.ok ? `${followed.ms}ms` : 'never'})`,
      followed.ok,
      'not within 12s',
    )
    await sleep(1500)
  }
  const landed = timings.filter((t) => t !== null)
  const worst = landed.length ? Math.max(...landed) : null
  console.log(`    follow times: ${JSON.stringify(timings)}`)
  // 500ms of debounce plus a round trip. The transport's own presence latency,
  // measured separately against this project, has a median of ~1s — so the budget
  // here is that plus the debounce plus a render, and 4s is the point at which a
  // person stops believing the dot.
  check(
    `every follow lands within 4s (worst ${worst ?? 'n/a'}ms)`,
    landed.length === walk.length && worst < 4000,
    `${landed.length}/${walk.length} landed`,
  )

  // --- the venue wifi ------------------------------------------------------
  //
  // The condition this app is actually used in. A drop closes the socket, so the
  // roster loses that person and their dot goes — which is correct, and is also
  // exactly what a channel that died and never came back looks like. So the
  // assertion is the RETURN, not the disappearance.
  console.log('\n==> The guest loses wifi for 6s, then gets it back')
  const before = await sidebarDots(host)
  check('the host can see the guest to begin with', before?.length === 1, JSON.stringify(before))
  await guest.cdp('Network.enable')
  await guest.cdp('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  })
  const dropped = await host.until(
    `!document.querySelector('aside [data-presence="dot"]')`,
    30000,
    250,
  )
  check(`the host stops seeing them while they are gone (${dropped.ms}ms)`, dropped.ok, 'dot never cleared')
  await sleep(6000)
  await guest.cdp('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
  const returned = await untilDot(host, 60000)
  check(
    `and sees them again once wifi returns (${returned.ms}ms)`,
    returned.ok && returned.value?.href === walk[walk.length - 1],
    `got ${JSON.stringify(returned.value)}, wanted ${walk[walk.length - 1]}`,
  )
  const guestChipBack = await host.until(
    `(() => { const e = document.querySelector('header [data-presence="chip"]'); return e ? e.innerText.trim() : null })() === '1 here now'`,
    30000,
    250,
  )
  check(`and the header count recovers (${guestChipBack.ms}ms)`, guestChipBack.ok)

  // --- 4. the phone header, measured ----------------------------------------
  console.log('\n==> CHECK 4 — the header at 390px with somebody present')
  await host.emulate({ width: 390, height: 844, scale: 2 })
  await sleep(1200)
  // The first-run coach marks lay a scrim over the whole viewport, header
  // included. Left up, `elementFromPoint` correctly reports the chip as buried
  // and the check measures the tour instead of the header. Take it down first,
  // the way the person whose header this is would.
  for (let i = 0; i < 6; i++) {
    const skipped = await clickButton(host, '/^(Skip|Got it|Close)$/i', 'body')
    if (skipped !== 'clicked') break
    await sleep(400)
  }
  await sleep(600)
  const phone = await host.evaluate(`
    const chip = [...document.querySelectorAll('header [data-presence="chip"]')]
      .find(e => e.getBoundingClientRect().width > 0)
    if (!chip) return { rendered: false }
    const r = chip.getBoundingClientRect()
    const row = chip.parentElement
    // The LAYOUT viewport, not the 390 we asked for: Chrome renders a classic
    // scrollbar here, so documentElement.clientWidth is 375 and every "does it
    // fit" comparison against 390 is 15px of scrollbar wide.
    const viewport = document.documentElement.clientWidth
    // Is the chip's own centre the topmost thing there? An element pushed under a
    // sibling or a scrim reads identically to a visible one through innerText.
    const mid = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    const siblings = [...row.children].map(el => {
      const cr = el.getBoundingClientRect()
      return { tag: el.tagName, text: (el.innerText||'').trim().slice(0, 28), left: Math.round(cr.left), right: Math.round(cr.right), w: Math.round(cr.width) }
    })
    return {
      rendered: true,
      viewport,
      text: (chip.innerText||'').trim(),
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      onTop: chip === mid || chip.contains(mid),
      onTopIs: mid ? (mid.tagName + '.' + String(mid.className || '').slice(0, 40)) : null,
      rowOverflow: row.scrollWidth - row.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - viewport,
      // If the page does scroll sideways, name what is doing it. "15px somewhere"
      // is not actionable, and the guess it invites (the header, because that is
      // what was being looked at) is the expensive kind of wrong.
      overflowing: [...document.querySelectorAll('*')]
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.right > viewport + 0.5 || r.left < -0.5))
        .map(({ el, r }) => ({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 60),
          inHeader: Boolean(el.closest('header')),
          // On the stable hook, not on a class-name substring. The previous version
          // sniffed for /emerald/ in a className truncated to 60 characters, which
          // cut the string one character before the word it was looking for — so the
          // gate below matched nothing and passed unconditionally.
          isPresence: Boolean(el.closest('[data-presence]')),
          left: Math.round(r.left),
          right: Math.round(r.right),
        }))
        .slice(0, 8),
      siblings,
    }
  `)
  check('the presence chip is rendered on a phone', phone.rendered === true, JSON.stringify(phone))
  if (phone.rendered) {
    console.log(`    row: ${JSON.stringify(phone.siblings)}`)
    check(
      `the chip fits inside the ${phone.viewport}px viewport (left ${phone.rect.left}, right ${phone.rect.right})`,
      phone.rect.left >= 0 && phone.rect.right <= phone.viewport && phone.rect.w > 0 && phone.rect.h > 0,
      JSON.stringify(phone.rect),
    )
    check('nothing is stacked on top of it', phone.onTop === true, `topmost is ${phone.onTopIs}`)
    check(
      `the context strip does not overflow (${phone.rowOverflow}px)`,
      phone.rowOverflow <= 1,
      `${phone.rowOverflow}px of hidden content`,
    )
    // Scoped to what this spec owns. The page DOES scroll sideways by 15px at
    // 390px, but the overflowing element is the account-menu avatar in the top
    // header row — a row the presence chip is not even in below 640px, since it
    // is `hidden sm:flex` there and lives in the context strip instead. Failing
    // spec 12 for a pre-existing bug in somebody else's row would make this gate
    // lie in both directions: red when presence is fine, and no more likely to go
    // green when presence breaks. It is reported loudly instead.
    const mine = phone.overflowing.filter((e) => e.isPresence)
    check(
      `nothing presence added overflows the viewport`,
      mine.length === 0,
      JSON.stringify(mine),
    )
    if (phone.pageOverflow > 1) {
      console.log(
        `    WARN pre-existing, not presence: the page scrolls sideways ${phone.pageOverflow}px at 390px.` +
          `\n         Culprit is the account menu in the TOP header row: ` +
          JSON.stringify(phone.overflowing.filter((e) => e.inHeader).slice(0, 2)),
      )
    }
    check(
      'every chip in the strip keeps a visible width',
      phone.siblings.every((s) => s.w > 0 && s.left >= 0 && s.right <= phone.viewport + 1),
      JSON.stringify(phone.siblings),
    )
  }
  const shot = await host.screenshot(`${SHOTS}/presence-390.png`)
  console.log(`    screenshot: ${shot}`)
  await host.emulate({ width: 1280, height: 900, scale: 1 })

  // --- 2. the escape hatch ---------------------------------------------------
  console.log('\n==> CHECK 2 — ?sync=poll: no presence, ordinary sync still working')
  const socketsBefore = hostSockets.matching(REALTIME).length
  await host.goto(`${APP_URL}?sync=poll`, 6000)
  await host.until(`Boolean(document.querySelector('main'))`, 20000)
  // Long enough that a channel which was going to open has opened: the join runs
  // after `initSyncMode()` resolves, so a check that looked immediately would pass
  // for the wrong reason.
  await sleep(6000)
  check(
    'no new realtime socket is opened under ?sync=poll',
    hostSockets.matching(REALTIME).length === socketsBefore,
    `${hostSockets.matching(REALTIME).length} vs ${socketsBefore}`,
  )
  check('no presence chip in the header', (await headerChip(host)) === null)
  const pollDots = await sidebarDots(host)
  check('no dots in the sidebar', pollDots?.length === 0, JSON.stringify(pollDots))

  const laterAt = new Date(Date.now() + 2000).toISOString()
  await acc.rest(guestUser, '/rpc/push_records', {
    method: 'POST',
    body: JSON.stringify({
      p_project: PROJECT_ID,
      p_records: [
        rec(
          'entries',
          `seed-entry-${stamp}`,
          {
            id: `seed-entry-${stamp}`,
            project_id: PROJECT_ID,
            node_id: '1a',
            genre_id: 'seed-genre',
            cell_key: 'c1',
            text: LATER,
            source_language: 'id',
            routing_status: 'none',
            sync_status: 'synced',
            created_at: nowIso,
            updated_at: laterAt,
          },
          laterAt,
        ),
      ],
    }),
  })
  const stillSyncs = await hasEntry(host, LATER)
  check(`ordinary sync still works under ?sync=poll (${stillSyncs.ms}ms)`, stillSyncs.ok, 'not within 25s')

  const hostErrs = hostErrors().filter((e) => !isPagesRoute404(e))
  check(
    `no page errors across the whole signed-in run (${hostErrs.length})`,
    hostErrs.length === 0,
    JSON.stringify(hostErrs.slice(0, 4)),
  )
  // Leave the device the way a facilitator would want to find it: the mode is
  // remembered, so a run that walked away in `poll` would hand the next session a
  // browser with presence silently off.
  await host.goto(`${APP_URL}?sync=live`, 4000)

  // --- 3a. signed out, Supabase configured -----------------------------------
  console.log('\n==> CHECK 3a — signed out: no channel, no errors')
  lonely = await launch('preslonely')
  await lonely.emulate({ width: 1280, height: 900, scale: 1 })
  const lonelySockets = await lonely.watchSockets()
  const lonelyErrors = await lonely.watchErrors()
  await lonely.goto(APP_URL, 4000)
  await lonely.until(`Boolean(document.querySelector('main, [data-onboarding-gate]'))`, 20000)
  await sleep(6000)
  check('signed out opens no realtime socket', lonelySockets.matching(REALTIME).length === 0, JSON.stringify(lonelySockets.matching(REALTIME)))
  check('signed out shows no presence chip', (await headerChip(lonely)) === null)
  const lonelyErrs = lonelyErrors().filter((e) => !isPagesRoute404(e))
  check(`signed out logs no errors (${lonelyErrs.length})`, lonelyErrs.length === 0, JSON.stringify(lonelyErrs.slice(0, 4)))

  // --- 3b. Supabase not configured at all ------------------------------------
  if (!UNCONFIGURED_URL) {
    console.log('\n==> CHECK 3b skipped — set UNCONFIGURED_URL to a build with no VITE_SUPABASE_*')
    failures++
    console.log('    FAIL the unconfigured build was not checked')
  } else {
    console.log(`\n==> CHECK 3b — Supabase unconfigured (${UNCONFIGURED_URL})`)
    unconfigured = await launch('presnosb')
    await unconfigured.emulate({ width: 1280, height: 900, scale: 1 })
    const noSbSockets = await unconfigured.watchSockets()
    const noSbRequests = await unconfigured.watchRequests()
    const noSbErrors = await unconfigured.watchErrors()
    await unconfigured.goto(UNCONFIGURED_URL, 4000)
    await unconfigured.until(`Boolean(document.querySelector('main, [data-onboarding-gate]'))`, 20000)
    await sleep(6000)
    // Behavioural, not textual: a build with no client configured never talks to
    // a Supabase host at all. Reading the page for a sign-in control was the
    // earlier version of this check, and it failed on the word "account"
    // appearing in ordinary onboarding copy.
    const sbCalls = noSbRequests.matching(/supabase\.co/)
    check('the unconfigured build never calls Supabase', sbCalls.length === 0, JSON.stringify(sbCalls.slice(0, 3)))
    check('it opens no websocket at all', noSbSockets.all().length === 0, JSON.stringify(noSbSockets.all()))
    check('it shows no presence chip', (await headerChip(unconfigured)) === null)
    const noSbErrs = noSbErrors().filter((e) => !isPagesRoute404(e))
    check(`it logs no errors (${noSbErrs.length})`, noSbErrs.length === 0, JSON.stringify(noSbErrs.slice(0, 4)))
  }
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.stack ?? err.message}`)
} finally {
  await host?.close()
  await guest?.close()
  await lonely?.close()
  await unconfigured?.close()
  await acc.sql(`delete from public.shared_projects where project_id = '${PROJECT_ID}'`)
  await acc.destroy()
}

console.log(failures === 0 ? '\n    Presence browser gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
