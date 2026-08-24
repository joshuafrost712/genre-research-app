#!/usr/bin/env node
/**
 * Two accounts, one browser. Joshua's report, turned into a gate.
 *
 *   node scripts/check-account-switch.mjs [url]
 *
 * On 2026-08-07 he created a brand-new account on his own laptop and it opened
 * onto joshuafrost712's worksheets. The visible half was bad. The invisible half
 * was worse: the first sync cycle after ANY sign-in published every local project
 * holding work under the new `auth.uid()`, so the previous person's translation
 * work was uploaded into the newcomer's cloud account, where last-write-wins
 * merging could then carry it over the original.
 *
 * The database had one name per browser origin and no concept of an owner, so
 * there was nothing for sign-out to clear things against.
 *
 * This asserts the four things that failure needed, against the production
 * bundle, because that is where it happened:
 *
 *   1. a deliberate sign-out KEEPS local work (the choice made on 2026-08-07:
 *      signing back in as yourself must resume, not start over);
 *   2. a DIFFERENT account signing in wipes the device;
 *   3. nothing of the first person's reaches the second person's cloud account —
 *      the half that does lasting damage;
 *   4. the first person's work is still safe in their own account afterwards.
 *
 * Like check-two-device.mjs, the local work is written straight into IndexedDB in
 * the shape `createFocusText` + `trackUpsert` write, because `import('/src/…')`
 * does not exist in a built bundle. Everything downstream — hasWork, the
 * ownership check, publishActiveIfWorked, push — is the real deployed code.
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
const PASSAGE = `Habakkuk 3 ${stamp}`
const PROJECT = crypto.randomUUID()
const nowIso = new Date().toISOString()

const meta = async (b, key) => (await b.readTable('meta')).find((m) => m.key === key)?.value

const myProjects = async (user) =>
  (await (await acc.rest(user, '/rpc/my_projects', { method: 'POST', body: '{}' })).json()) ?? []

console.log(`==> App ${APP_URL}`)

let browser
try {
  const ada = await acc.create('switch-a')
  const grace = await acc.create('switch-b')
  console.log(`==> ${ada.email} then ${grace.email}, same browser`)

  // --- the first person works, signed in ------------------------------------
  browser = await launch('acctswitch')
  await browser.goto(APP_URL)
  await browser.signIn(REF, ada.session)
  await browser.goto(APP_URL, 4000)

  // The onboarding gate replaced the auto-starter: a fresh browser holds no
  // project until a person creates one. Seed the scoped project the gate's
  // Start panel would have written (the exact shape createScopedProject +
  // trackUpsert write), then the passage that turns it into "work" — which is
  // what publishActiveIfWorked will carry up to the account.
  await browser.evaluate(`
    let active = await new Promise((resolve) => {
      const req = indexedDB.open('genre-research')
      req.onsuccess = () => {
        const all = req.result.transaction('meta','readonly').objectStore('meta').getAll()
        all.onsuccess = () => resolve((all.result.find(m => m.key === 'activeProjectId') || {}).value)
      }
    })
    if (!active) {
      active = crypto.randomUUID()
      await new Promise((resolve) => {
        const req = indexedDB.open('genre-research')
        req.onsuccess = () => {
          const tx = req.result.transaction(['projects','outbox','meta'],'readwrite')
          const project = {
            id: active,
            name: 'Budaya uji genres in Bahasa uji',
            culture: 'Budaya uji',
            language: 'Bahasa uji',
            languages: [], team_members: [], scope: 'narrow',
            config_version: '1', is_sensitive: false,
            created_at: ${JSON.stringify(nowIso)}, updated_at: ${JSON.stringify(nowIso)},
          }
          tx.objectStore('projects').put(project)
          // Field names match src/lib/sync/types.ts OutboxRow ('table'/'recordId'),
          // which is what push.ts dedups and sends on.
          tx.objectStore('outbox').add({
            table: 'projects', recordId: active, op: 'upsert',
            project_id: active, updated_at: ${JSON.stringify(nowIso)}, data: project,
          })
          tx.objectStore('meta').put({ key: 'activeProjectId', value: active })
          tx.oncomplete = () => resolve(1)
        }
      })
    }
    await new Promise((resolve) => {
      const req = indexedDB.open('genre-research')
      req.onsuccess = () => {
        const dbh = req.result
        const tx = dbh.transaction(['focusTexts','outbox'],'readwrite')
        const row = {
          id: ${JSON.stringify(PROJECT)},
          project_id: active,
          reference: ${JSON.stringify(PASSAGE)},
          created_at: ${JSON.stringify(nowIso)},
          updated_at: ${JSON.stringify(nowIso)},
        }
        tx.objectStore('focusTexts').put(row)
        tx.objectStore('outbox').add({
          tbl: 'focusTexts', record_id: row.id, op: 'upsert',
          project_id: active, updated_at: ${JSON.stringify(nowIso)}, data: row,
        })
        tx.oncomplete = () => resolve(1)
      }
    })
    return 1
  `)

  const published = await browser.until(
    `(await (await fetch(${JSON.stringify(`${acc.base}/rest/v1/rpc/my_projects`)}, {
        method: 'POST',
        headers: {
          apikey: ${JSON.stringify(acc.anon)},
          Authorization: 'Bearer ' + ${JSON.stringify(ada.session.access_token)},
          'Content-Type': 'application/json',
        },
        body: '{}',
      })).json()).length > 0`,
    30000,
  )
  check(`the first person's work reaches their account (${published.ms}ms)`, published.ok)

  const adaProjects = await myProjects(ada)
  const adaProjectId = adaProjects[0]?.project_id

  // --- a deliberate sign-out ------------------------------------------------
  // Exactly what signOutBeta does: forget the account marker, drop the session.
  // Not a wipe — keeping the work here is the deliberate choice, so that signing
  // back in as yourself resumes rather than starting over.
  console.log('==> They sign out on purpose')
  await browser.evaluate(`
    localStorage.removeItem('genre.lastAccountEmail')
    localStorage.removeItem(${JSON.stringify(`sb-${REF}-auth-token`)})
    return 1
  `)
  await browser.goto(APP_URL, 4000)

  const keptAfterSignOut = (await browser.readTable('focusTexts')).map((f) => f.reference)
  check(
    'signing out keeps their work on the device',
    keptAfterSignOut.includes(PASSAGE),
    JSON.stringify(keptAfterSignOut),
  )
  check(
    'and the device still knows whose work it is holding',
    (await meta(browser, 'dataOwnerUid')) === ada.id,
    `dataOwnerUid=${await meta(browser, 'dataOwnerUid')} want=${ada.id}`,
  )

  // --- the second person signs in on the same browser -----------------------
  console.log('==> A different person creates an account on the same browser')
  await browser.signIn(REF, grace.session)
  await browser.goto(APP_URL, 4000)
  // The wipe reloads the page; give the reboot a cycle to settle before reading.
  await sleep(6000)

  const seenByGrace = (await browser.readTable('focusTexts')).map((f) => f.reference)
  check(
    'the newcomer does NOT see the previous person’s passage',
    !seenByGrace.includes(PASSAGE),
    JSON.stringify(seenByGrace),
  )
  check(
    'the device is now stamped to the newcomer',
    (await meta(browser, 'dataOwnerUid')) === grace.id,
    `dataOwnerUid=${await meta(browser, 'dataOwnerUid')} want=${grace.id}`,
  )

  // The half that does lasting damage. Poll rather than sample once: the bug was
  // an upload on the first sync cycle, so a single early read could miss it.
  await sleep(8000)
  const graceProjects = await myProjects(grace)
  check(
    'and NOTHING of theirs was published into the newcomer’s account',
    graceProjects.length === 0,
    `${graceProjects.length}: ${JSON.stringify(graceProjects.map((p) => p.name))}`,
  )

  // --- and the first person is unharmed -------------------------------------
  const adaAfter = await myProjects(ada)
  check(
    'the first person’s work is still theirs, in their own account',
    adaAfter.length === 1 && adaAfter[0].project_id === adaProjectId,
    `${adaAfter.length}: ${JSON.stringify(adaAfter.map((p) => p.name))}`,
  )
} finally {
  await browser?.close()
  await acc.destroy()
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
