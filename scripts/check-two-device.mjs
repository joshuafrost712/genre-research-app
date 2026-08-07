#!/usr/bin/env node
/**
 * One account, two browsers. Joshua's report, turned into a gate.
 *
 *   node scripts/check-two-device.mjs [url]
 *
 * On 2026-08-07 he added Psalm 124 in Safari and it never showed up in Chrome.
 * The row replicated perfectly and within seconds; Chrome was simply pointed at
 * a different project. Both browsers had published the empty starter they made
 * for themselves at sign-in, and adoption declined to move a device that was
 * "already on a synced project".
 *
 * So this script asserts the three things that failure needed, and works against
 * the minified production bundle because that is where it happened:
 *
 *   1. signing in on a fresh browser publishes NOTHING (an empty starter is not
 *      work, and a published empty starter is what competes for the pointer);
 *   2. a browser sitting on an empty starter ADOPTS the project that holds the
 *      passages, and adopts its containers too;
 *   3. doing real work publishes the project it was done in, without a reload.
 *
 * Step 3 writes the focusText row and its outbox row into IndexedDB directly,
 * because `import('/src/...')` does not exist in a built bundle. That is the
 * only faked part: it writes exactly what `createFocusText` + `trackUpsert`
 * write, and everything downstream — hasWork, publishActiveIfWorked, push — is
 * the real deployed code.
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

const acc = await accounts(REF, PAT)
const stamp = Date.now().toString(36)
const PASSAGE = `Psalm 124 ${stamp}`
const LATER = `Isaiah 28 ${stamp}`
const SEEDED = crypto.randomUUID()
const nowIso = new Date().toISOString()

const meta = async (b, key) =>
  (await b.readTable('meta')).find((m) => m.key === key)?.value

console.log(`==> App ${APP_URL}`)

let safari, chrome
let bornInChrome = null
try {
  const user = await acc.create('twodev')
  console.log(`==> ${user.email} on two browsers`)

  const myProjects = async () =>
    (await (await acc.rest(user, '/rpc/my_projects', { method: 'POST', body: '{}' })).json()) ?? []

  // --- 1. an empty starter must not reach the cloud --------------------------
  console.log('==> Browser one signs in and does nothing')
  safari = await launch('twodev-a')
  await safari.goto(APP_URL)
  await safari.signIn(REF, user.session)
  await safari.goto(APP_URL, 9000)

  const afterIdleSignIn = await myProjects()
  check(
    'signing in and doing nothing publishes nothing',
    afterIdleSignIn.length === 0,
    `${afterIdleSignIn.length} project(s) published: ${JSON.stringify(afterIdleSignIn.map((p) => p.name))}`,
  )

  // --- 2. adoption, the actual bug -------------------------------------------
  // Seed a project that holds a passage, the way his Safari project did.
  console.log(`==> A worksheet holding "${PASSAGE}" appears on the account`)
  const rec = (tbl, id, data) => ({
    tbl,
    record_id: id,
    op: 'upsert',
    updated_at: nowIso,
    author_id: 'seed',
    data,
  })
  await acc.rest(user, '/rpc/create_shared_project', {
    method: 'POST',
    body: JSON.stringify({ p_project: SEEDED, p_name: `Real worksheet ${stamp}` }),
  })
  await acc.rest(user, '/rpc/push_records', {
    method: 'POST',
    body: JSON.stringify({
      p_project: SEEDED,
      p_records: [
        rec('projects', SEEDED, {
          id: SEEDED,
          name: `Real worksheet ${stamp}`,
          languages: ['id'],
          team_members: [],
          scope: 'narrow',
          config_version: 1,
          is_sensitive: false,
          created_at: nowIso,
          updated_at: nowIso,
        }),
        rec('focusTexts', `${SEEDED}-ft`, {
          id: `${SEEDED}-ft`,
          project_id: SEEDED,
          reference: PASSAGE,
          created_at: nowIso,
          updated_at: nowIso,
        }),
        rec('genres', `${SEEDED}-g`, {
          id: `${SEEDED}-g`,
          project_id: SEEDED,
          name: 'Kidung ratapan',
          created_at: nowIso,
          updated_at: nowIso,
        }),
      ],
    }),
  })

  const adopted = await safari.until(
    `(await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onerror = () => resolve(null)
        req.onsuccess = () => {
          const dbh = req.result
          const all = dbh.transaction('meta','readonly').objectStore('meta').getAll()
          all.onsuccess = () => resolve((all.result.find(m => m.key === 'activeProjectId') || {}).value)
          all.onerror = () => resolve(null)
        }
      })) === ${JSON.stringify(SEEDED)}`,
    25000,
  )
  check(
    `the browser moves itself onto the worksheet with the passage (${adopted.ms}ms)`,
    adopted.ok,
    `activeProjectId=${await meta(safari, 'activeProjectId')}`,
  )
  check(
    'and onto its genre, so it cannot mint an "Untitled genre" into it',
    (await meta(safari, `activeGenre:${SEEDED}`)) === `${SEEDED}-g`,
    `activeGenre=${await meta(safari, `activeGenre:${SEEDED}`)}`,
  )
  const seenPassages = (await safari.readTable('focusTexts')).map((f) => f.reference)
  check('the passage itself is on the device', seenPassages.includes(PASSAGE), JSON.stringify(seenPassages))

  // --- 3. a second browser lands in the same place ---------------------------
  console.log('==> Browser two signs in for the first time')
  chrome = await launch('twodev-b')
  await chrome.goto(APP_URL)
  await chrome.signIn(REF, user.session)
  await chrome.goto(APP_URL, 3000)

  const secondAdopted = await chrome.until(
    `(await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onerror = () => resolve(null)
        req.onsuccess = () => {
          const dbh = req.result
          const all = dbh.transaction('meta','readonly').objectStore('meta').getAll()
          all.onsuccess = () => resolve((all.result.find(m => m.key === 'activeProjectId') || {}).value)
          all.onerror = () => resolve(null)
        }
      })) === ${JSON.stringify(SEEDED)}`,
    25000,
  )
  check(
    `a brand-new browser opens the same worksheet, not its own starter (${secondAdopted.ms}ms)`,
    secondAdopted.ok,
    `activeProjectId=${await meta(chrome, 'activeProjectId')}`,
  )

  const twoStarters = await myProjects()
  check(
    'and still nobody published an empty starter',
    twoStarters.length === 1,
    `${twoStarters.length}: ${JSON.stringify(twoStarters.map((p) => p.name))}`,
  )

  // --- 4. work done locally publishes itself, no reload ----------------------
  // Adding a passage to a LOCAL-only project must carry that project up.
  console.log('==> Browser two starts a second worksheet of its own')
  bornInChrome = await chrome.evaluate(`
    const pid = crypto.randomUUID()
    const at = new Date().toISOString()
    const put = (store, value) => new Promise((resolve, reject) => {
      const req = indexedDB.open('genre-research')
      req.onsuccess = () => {
        const tx = req.result.transaction(store, 'readwrite')
        tx.objectStore(store).put(value)
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
    await put('projects', { id: pid, name: 'Second worksheet', languages: ['id'], team_members: [],
      scope: 'narrow', config_version: 1, is_sensitive: false, created_at: at, updated_at: at })
    const ft = { id: pid + '-ft', project_id: pid, reference: ${JSON.stringify(LATER)},
      created_at: at, updated_at: at }
    await put('focusTexts', ft)
    // exactly what trackUpsert appends
    await put('outbox', { table: 'focusTexts', recordId: ft.id, project_id: pid, op: 'upsert',
      updated_at: at, data: ft })
    await put('meta', { key: 'activeProjectId', value: pid })
    await put('meta', { key: 'activeFocusText:' + pid, value: ft.id })
    return pid
  `)

  const published = await (async () => {
    const started = Date.now()
    for (;;) {
      const list = await myProjects()
      if (list.some((p) => p.project_id === bornInChrome)) return { ok: true, ms: Date.now() - started }
      if (Date.now() - started > 25000) return { ok: false, ms: Date.now() - started }
      await sleep(1000)
    }
  })()
  check(
    `working in a local project publishes it, with no reload (${published.ms}ms)`,
    published.ok,
    'never appeared in my_projects',
  )

  const arrived = await safari.until(
    `(await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onerror = () => resolve(0)
        req.onsuccess = () => {
          const dbh = req.result
          const all = dbh.transaction('focusTexts','readonly').objectStore('focusTexts').getAll()
          all.onsuccess = () => resolve(all.result.filter(f => f.reference === ${JSON.stringify(LATER)}).length)
          all.onerror = () => resolve(0)
        }
      })) > 0`,
    25000,
  )
  check(`and the other browser receives that passage (${arrived.ms}ms)`, arrived.ok, 'not within 25s')

  // The other browser must NOT be dragged off the worksheet it is working in.
  check(
    'without dragging the other browser off the worksheet it was on',
    (await meta(safari, 'activeProjectId')) === SEEDED,
    `activeProjectId=${await meta(safari, 'activeProjectId')}`,
  )
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.message}`)
} finally {
  await safari?.close()
  await chrome?.close()
  await acc.sql(`delete from public.shared_projects where project_id = '${SEEDED}'`)
  if (bornInChrome) await acc.sql(`delete from public.shared_projects where project_id = '${bornInChrome}'`)
  await acc.destroy()
}

console.log(failures === 0 ? '\n    two-device gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
