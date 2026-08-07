#!/usr/bin/env node
/**
 * The gate for "I did not know I was signed out."
 *
 *   npm run dev                                     # in another terminal
 *   node scripts/check-signed-out-visible.mjs       # or pass a URL for the deploy
 *
 * On 2026-08-07 Chrome came back from sleep signed out while Safari, on the same
 * machine, stayed signed in — and nothing on screen said so, because the sync
 * chip returned null in exactly that state. An hour of answers went into a device
 * with no account behind it.
 *
 * A unit test cannot catch this: the bug was a component rendering NOTHING, which
 * every green assertion about the rest of the app is compatible with. So this
 * asserts against the real DOM:
 *
 *   1. a signed-out visitor sees an explicit "on this device only" indicator;
 *   2. a device that has never signed in is NOT shown the session-lost modal
 *      (being a guest is a choice, not a fault);
 *   3. a device that remembers an account and has no session IS shown it;
 *   4. dismissing it leaves the standing local-only banner behind.
 */
import { launch, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/** Visible text of the whole page, collapsed, for substring assertions. */
const BODY_TEXT = `return document.body.innerText.replace(/\\s+/g, ' ')`

const browser = await launch('signedout')
try {
  console.log(`\n  ${APP_URL}`)

  // 1 + 2. A first-time guest.
  await browser.goto(APP_URL, 3500)

  const guestText = await browser.evaluate(BODY_TEXT)
  check(
    'signed-out visitor sees an explicit local-only indicator',
    /on this device only/i.test(guestText),
    'no "On this device only" anywhere on the page',
  )
  check(
    'a first-time guest is not told they were signed out',
    !/you have been signed out/i.test(guestText),
    'the session-lost modal showed to someone who never had an account',
  )

  // 3. A device that remembers an account, with no session. This is the exact
  // state Chrome was in: the marker survives, the Supabase token does not.
  await browser.evaluate(
    `localStorage.setItem('genre.lastAccountEmail', 'tester@example.org');
     sessionStorage.removeItem('genre.signedOutAck');
     return 1`,
  )
  await browser.goto(APP_URL, 3500)

  const lostText = await browser.evaluate(BODY_TEXT)
  check(
    'a dropped session is announced',
    /you have been signed out/i.test(lostText),
    'no modal for a device that had an account and now has no session',
  )

  // 4. Choosing "continue without an account" leaves something standing.
  const clicked = await browser.evaluate(`
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /continue without an account/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  `)
  check('the modal offers "continue without an account"', clicked === true)

  if (clicked) {
    await sleep(600)
    const afterText = await browser.evaluate(BODY_TEXT)
    check(
      'the modal closes once a choice is made',
      !/you have been signed out/i.test(afterText),
      'modal still up after choosing',
    )
    check(
      'a standing reminder survives the dismissal',
      /working on this device only/i.test(afterText),
      'nothing left on screen to say the work is not going to an account',
    )
  }
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\n  all checks passed\n' : `\n  ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
