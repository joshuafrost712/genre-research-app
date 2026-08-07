#!/usr/bin/env node
/**
 * The Phase 2 gate: two different PEOPLE, one shared worksheet.
 *
 *   npm run dev
 *   node scripts/check-team-browser.mjs                     # dev
 *   node scripts/check-team-browser.mjs <deployed-url>      # production
 *
 * Phase 1's gate was one account on two devices. This is the workshop case: two
 * accounts, one join code, each seeing the other's answers. It also asserts the
 * two failures that would look identical to broken sync from inside a room:
 *
 *   - the joiner must ADOPT the shared worksheet's containers, not keep pointing
 *     at the empty starter its own browser created seconds earlier;
 *   - joining must not leave a stray "Untitled genre" behind in the shared
 *     project, which is what happens when the pull races the switch.
 *
 * Uses raw IndexedDB reads throughout, so it works against a minified build.
 */
import { launch, accounts, sleep } from './lib/browser.mjs'

const APP_URL = process.argv[2] ?? 'http://localhost:5173/'
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

const acc = await accounts(REF, PAT)
const stamp = Date.now().toString(36)
const ANSWER = `Jawaban fasilitator ${stamp}`
const REPLY = `Balasan penerjemah ${stamp}`

console.log(`==> App ${APP_URL}`)

let host, guest
let projectId = null
try {
  const facilitator = await acc.create('facilitator')
  const translator = await acc.create('translator')
  console.log(`==> ${facilitator.email} shares; ${translator.email} joins`)

  host = await launch('host')
  guest = await launch('guest')

  // --- the facilitator sets the worksheet up and shares it -------------------
  console.log('==> Facilitator: set up a worksheet, type an answer, share the code')
  await host.goto(APP_URL)
  await host.signIn(REF, facilitator.session)
  await host.goto(APP_URL)

  projectId = await host.evaluate(`
    const { upsertEntry } = await import('/src/lib/storage/entries.ts')
    const { ensureActiveContext } = await import('/src/lib/storage/appState.ts')
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 'team-check', 'genre', { text: ${JSON.stringify(ANSWER)} })
    return ctx.projectId
  `)
  check('facilitator has a worksheet with an answer in it', typeof projectId === 'string', String(projectId))

  const shared = await host.evaluate(`
    const { shareActiveProject } = await import('/src/lib/sync/team.ts')
    const { code } = await shareActiveProject()
    return code
  `)
  check('sharing returns a readable join code', typeof shared === 'string' && shared.includes('-'), String(shared))

  const drained = await host.until(
    `(await (await import('/src/lib/storage/db.ts')).db.outbox.count()) === 0`,
    15000,
  )
  check('the facilitator\'s work reaches the cloud', drained.ok, `outbox still full after ${drained.ms}ms`)

  // Count the containers the facilitator legitimately owns. The facilitator's own
  // starter genre is called "Untitled genre" too, so the question is never
  // whether one exists, only whether joining CREATES another.
  const countContainers = async () => {
    const r = await acc.rest(
      facilitator,
      `/sync_records?project_id=eq.${projectId}&tbl=in.(genres,focusTexts,worksheets)&op=eq.upsert&select=tbl,record_id`,
    )
    const rows = await r.json()
    return Array.isArray(rows) ? rows.length : -1
  }
  const containersBefore = await countContainers()
  check('the shared worksheet has containers to adopt', containersBefore > 0, `${containersBefore}`)

  // --- a second person joins by code ----------------------------------------
  console.log('==> Translator: a different account, a different browser, joins by code')
  await guest.goto(APP_URL)
  await guest.signIn(REF, translator.session)
  await guest.goto(APP_URL)
  // Let the guest's own bootstrap finish first, so the test covers the hard case:
  // joining a team when this browser already made a starter project of its own.
  await sleep(4000)

  const joined = await guest.evaluate(`
    const { joinAndAdopt } = await import('/src/lib/sync/team.ts')
    const res = await joinAndAdopt(${JSON.stringify(shared)})
    return JSON.stringify(res)
  `)
  const joinRes = JSON.parse(joined)
  check('the translator joins', joinRes.projectId === projectId, joined)
  check('and the facilitator\'s work came down with the join', joinRes.applied > 0, `applied=${joinRes.applied}`)

  const guestEntries = await guest.readTable('entries')
  check(
    'the translator can read the facilitator\'s answer',
    guestEntries.some((e) => e.text === ANSWER),
    `${guestEntries.length} entries`,
  )

  // --- adoption, the failure that looks exactly like broken sync -------------
  const guestMeta = await guest.readTable('meta')
  const guestActive = guestMeta.find((m) => m.key === 'activeProjectId')?.value
  check(
    'the translator is POINTED at the shared worksheet, not their own starter',
    guestActive === projectId,
    `activeProjectId=${guestActive}`,
  )

  const guestGenre = guestMeta.find((m) => m.key === `activeGenre:${projectId}`)?.value
  check('and at the shared worksheet\'s genre', Boolean(guestGenre), `activeGenre=${guestGenre}`)

  // --- no junk left in the shared project ------------------------------------
  // The failure guarded against: a joiner whose ensureActiveContext races the
  // pull mints its own "Untitled genre" INTO the shared project. Six joiners,
  // six junk genres, each person still looking at their own.
  await sleep(5000) // let the joiner's next few sync cycles run
  const containersAfter = await countContainers()
  check(
    'joining created no extra containers in the shared worksheet',
    containersAfter === containersBefore,
    `${containersBefore} before, ${containersAfter} after`,
  )

  // --- the translator answers, the facilitator sees it -----------------------
  console.log('==> Translator answers; the facilitator sees it')
  await guest.evaluate(`
    const { db } = await import('/src/lib/storage/db.ts')
    const { upsertEntry } = await import('/src/lib/storage/entries.ts')
    const row = await db.entries.filter(e => e.text === ${JSON.stringify(ANSWER)}).first()
    await upsertEntry(
      { projectId: row.project_id, genreId: row.genre_id, focusTextId: '', worksheetId: '' },
      row.node_id, 'genre', { text: ${JSON.stringify(REPLY)} })
    return true
  `)

  const seen = await host.until(
    `(await (await import('/src/lib/storage/db.ts')).db.entries.filter(e => e.text === ${JSON.stringify(REPLY)}).count()) > 0`,
    20000,
  )
  check(`the facilitator sees the translator's answer (${seen.ms}ms)`, seen.ok, 'not within 20s')

  // --- and the overwritten text is recoverable -------------------------------
  const history = await host.readTable('history')
  check(
    'the replaced text is kept in history rather than lost',
    history.some((h) => h.prev_text === ANSWER && h.source === 'sync-overwrite'),
    `${history.length} history rows`,
  )
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.message}`)
} finally {
  await host?.close()
  await guest?.close()
  if (projectId) await acc.sql(`delete from public.shared_projects where project_id = '${projectId}'`)
  await acc.destroy()
}

console.log(failures === 0 ? '\n    team gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
