#!/usr/bin/env node
/**
 * The Bali gate, against the DEPLOYED build, driving the real UI.
 *
 *   node scripts/check-team-live.mjs [url]
 *
 * check-team-browser.mjs proves the team logic by calling the sync modules,
 * which only exist under `vite dev`. This one clicks the buttons a facilitator
 * and a translator will actually click, on the minified bundle they will
 * actually load. It is the closest thing to a rehearsal that can be run from a
 * desk, and it is the check to re-run before flying.
 *
 * The facilitator's worksheet is seeded over the API so the test does not depend
 * on the worksheet's own navigation, but everything about sharing and joining
 * goes through the page: the Share button, the code rendered on screen, the code
 * input, the Join button.
 */
import { launch, accounts, sleep } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'https://joshuafrost712.github.io/genre-research-app/').replace(
  /\/?$/,
  '/',
)
const REF = process.env.PROJECT_REF ?? 'ckorlrchryswnnrmuctr'
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN required (source ~/.claude/secrets/supabase.env).')
  process.exit(1)
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

/** Click the first button whose visible text matches. */
const clickButton = (page, pattern) =>
  page.evaluate(`
    const el = [...document.querySelectorAll('button')]
      .find(b => ${pattern}.test(b.textContent || ''))
    if (!el) return 'not-found'
    el.click()
    return 'clicked'
  `)

const acc = await accounts(REF, PAT)
const stamp = Date.now().toString(36)
const ANSWER = `Jawaban fasilitator ${stamp}`
const REPLY = `Balasan penerjemah ${stamp}`
const PROJECT_ID = crypto.randomUUID()
const nowIso = new Date().toISOString()

console.log(`==> App ${APP_URL}`)

let host, guest
try {
  const facilitator = await acc.create('livefac')
  const translator = await acc.create('livetrx')
  console.log(`==> ${facilitator.email} shares; ${translator.email} joins`)

  // Seed the facilitator's worksheet: a project, a genre to answer against, and
  // one answer already typed.
  // `at` is the LWW key the server compares, NOT the copy inside `data`. Getting
  // that wrong is how a later edit gets refused as not-newer, which is exactly
  // what push_records is supposed to do and exactly what it did the first time
  // this script was run.
  const rec = (tbl, id, data, at = nowIso) => ({
    tbl,
    record_id: id,
    op: 'upsert',
    updated_at: at,
    author_id: 'seed',
    data,
  })
  await acc.rest(facilitator, '/rpc/create_shared_project', {
    method: 'POST',
    body: JSON.stringify({ p_project: PROJECT_ID, p_name: `Bali team check ${stamp}` }),
  })
  await acc.rest(facilitator, '/rpc/push_records', {
    method: 'POST',
    body: JSON.stringify({
      p_project: PROJECT_ID,
      p_records: [
        rec('projects', PROJECT_ID, {
          id: PROJECT_ID,
          name: `Bali team check ${stamp}`,
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
  console.log('==> Seeded the facilitator worksheet')

  host = await launch('livehost')
  guest = await launch('liveguest')

  // --- facilitator reads the code off the page -------------------------------
  console.log('==> Facilitator opens Shared worksheets and reads the code')
  await host.goto(APP_URL)
  await host.signIn(REF, facilitator.session)
  await host.goto(`${APP_URL}teams`, 5000)

  const teamsText = await host.evaluate(`return document.body.innerText`)
  check('the Shared worksheets page renders on the deployed build', /Shared worksheets/i.test(teamsText))
  check(
    'and it leads with the one-person-shares rule',
    /One person shares, everyone else joins/i.test(teamsText),
  )

  const codeShown = await host.until(
    `(() => { const m = document.body.innerText.match(/[a-z]+-[a-z]+-[a-z]+-\\d{3}/); return m ? m[0] : null })()`,
    20000,
  )
  check('the join code is visible on the page', codeShown.ok, `not found in ${codeShown.ms}ms`)
  const code = codeShown.value

  // --- translator joins through the form -------------------------------------
  console.log(`==> Translator types ${code} into the join form`)
  await guest.goto(APP_URL)
  await guest.signIn(REF, translator.session)
  await guest.goto(`${APP_URL}teams`, 5000)

  const typed = await guest.evaluate(`
    const input = [...document.querySelectorAll('input')]
      .find(i => /summit|code/i.test(i.placeholder || ''))
    if (!input) return 'no-input'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(code)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return input.value
  `)
  check('the join form accepts the code', typed === code, String(typed))

  const clicked = await clickButton(guest, '/^Join/')
  check('the Join button is there and clickable', clicked === 'clicked', String(clicked))

  const arrived = await guest.until(
    `(await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onerror = () => resolve(0)
        req.onsuccess = () => {
          const dbh = req.result
          if (!dbh.objectStoreNames.contains('entries')) return resolve(0)
          const all = dbh.transaction('entries','readonly').objectStore('entries').getAll()
          all.onsuccess = () => resolve(all.result.filter(e => e.text === ${JSON.stringify(ANSWER)}).length)
          all.onerror = () => resolve(0)
        }
      })) > 0`,
    25000,
  )
  check(`the facilitator's answer reaches the translator (${arrived.ms}ms)`, arrived.ok, 'not within 25s')

  const guestMeta = await guest.readTable('meta')
  check(
    'the translator is pointed at the shared worksheet, not their own starter',
    guestMeta.find((m) => m.key === 'activeProjectId')?.value === PROJECT_ID,
    `activeProjectId=${guestMeta.find((m) => m.key === 'activeProjectId')?.value}`,
  )
  check(
    'and at the shared genre',
    guestMeta.find((m) => m.key === `activeGenre:${PROJECT_ID}`)?.value === 'seed-genre',
    `activeGenre=${guestMeta.find((m) => m.key === `activeGenre:${PROJECT_ID}`)?.value}`,
  )

  // --- the translator answers, over the wire, back to the facilitator --------
  console.log('==> Translator answers; the facilitator sees it')
  const replyAt = new Date(Date.now() + 1000).toISOString()
  await acc.rest(translator, '/rpc/push_records', {
    method: 'POST',
    body: JSON.stringify({
      p_project: PROJECT_ID,
      p_records: [
        rec('entries', `seed-entry-${stamp}`, {
          id: `seed-entry-${stamp}`,
          project_id: PROJECT_ID,
          node_id: '1a',
          genre_id: 'seed-genre',
          cell_key: 'c1',
          text: REPLY,
          source_language: 'id',
          routing_status: 'none',
          sync_status: 'synced',
          created_at: nowIso,
          updated_at: replyAt,
        }, replyAt),
      ],
    }),
  })

  const serverRow = await (
    await acc.rest(
      facilitator,
      `/sync_records?project_id=eq.${PROJECT_ID}&record_id=eq.seed-entry-${stamp}&select=data`,
    )
  ).json()
  check(
    'the translator\'s write lands on the server',
    serverRow?.[0]?.data?.text === REPLY,
    JSON.stringify(serverRow?.[0]?.data?.text),
  )

  const back = await host.until(
    `(await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onerror = () => resolve(0)
        req.onsuccess = () => {
          const dbh = req.result
          if (!dbh.objectStoreNames.contains('entries')) return resolve(0)
          const all = dbh.transaction('entries','readonly').objectStore('entries').getAll()
          all.onsuccess = () => resolve(all.result.filter(e => e.text === ${JSON.stringify(REPLY)}).length)
          all.onerror = () => resolve(0)
        }
      })) > 0`,
    25000,
  )
  check(`the facilitator sees the reply (${back.ms}ms)`, back.ok, 'not within 25s')

  // --- the in-room escape hatch ----------------------------------------------
  console.log('==> The ?sync=off downgrade')
  await host.goto(`${APP_URL}?sync=off`, 5000)
  const offChip = await host.until(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => /Sync off/.test(x.textContent||'')); return b ? b.textContent.trim() : null })()`,
    10000,
  )
  check('?sync=off is honoured and says so in the header', offChip.ok, String(offChip.value))

  await host.goto(`${APP_URL}?sync=live`, 5000)
  const onChip = await host.until(
    `(() => { const b = [...document.querySelectorAll('button')].find(x => /Saved|waiting/.test(x.textContent||'')); return b ? b.textContent.trim() : null })()`,
    15000,
  )
  check('?sync=live turns it back on', onChip.ok, String(onChip.value))
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.message}`)
} finally {
  await host?.close()
  await guest?.close()
  await acc.sql(`delete from public.shared_projects where project_id = '${PROJECT_ID}'`)
  await acc.destroy()
}

console.log(failures === 0 ? '\n    Bali team gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
