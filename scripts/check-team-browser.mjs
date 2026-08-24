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

let host, guest, newcomer
let projectId = null
let newcomerEmail = null
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

  // --- the team gets a name --------------------------------------------------
  // The Psalms-workshop failure in one line: on the live project all 27 published
  // worksheets were called "Untitled project", because nothing in the app could
  // set a name and the team list reads shared_projects.name, which
  // create_shared_project writes once and never revisits.
  console.log('==> Facilitator names the team')
  const TEAM_NAME = `Walak team ${stamp}`
  await host.evaluate(`
    const { renameTeam } = await import('/src/lib/team/rename.ts')
    await renameTeam(${JSON.stringify(projectId)}, ${JSON.stringify(TEAM_NAME)}, { shared: true })
    return true
  `)
  const namedRow = await acc.rest(
    facilitator,
    `/rpc/my_projects`,
    { method: 'POST', body: '{}' },
  ).then((r) => r.json())
  check(
    'the name is stored where every member reads it (shared_projects.name)',
    Array.isArray(namedRow) && namedRow.some((p) => p.name === TEAM_NAME),
    JSON.stringify(namedRow?.map?.((p) => p.name)),
  )

  const chipShows = await host.until(
    `document.body.innerText.includes(${JSON.stringify(TEAM_NAME)})`,
    15000,
  )
  check('and the facilitator sees it in the header', chipShows.ok, 'name never rendered')

  // --- a second person joins by code ----------------------------------------
  console.log('==> Translator: a different account, a different browser, joins by code')
  await guest.goto(APP_URL)
  await guest.signIn(REF, translator.session)
  await guest.goto(APP_URL)
  // Let the guest's own bootstrap finish first, so the test covers the hard case:
  // joining a team when this browser already made a starter project of its own.
  await sleep(4000)

  // Keep the guest's OWN starter id: switching back to it later is how the drift
  // banner is provoked, and it is the exact situation ~25 workshop participants
  // were in without being told.
  const guestOwnProject = (await guest.readTable('meta')).find(
    (m) => m.key === 'activeProjectId',
  )?.value

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

  // --- the joiner can tell whose worksheet they are in -----------------------
  console.log('==> Translator can see which team they are in, and who is on it')
  await guest.goto(APP_URL)
  const guestSeesName = await guest.until(
    `document.body.innerText.includes(${JSON.stringify(TEAM_NAME)})`,
    15000,
  )
  check('the joiner sees the team name, not "Untitled project"', guestSeesName.ok, 'name absent')

  const members = await guest.evaluate(`
    const { listProjectMembers } = await import('/src/lib/sync/supabase/projects.ts')
    const rows = await listProjectMembers(${JSON.stringify(projectId)})
    return JSON.stringify(rows.map(r => r.email).sort())
  `)
  check(
    'and can see who else is on the team',
    members.includes(facilitator.email) && members.includes(translator.email),
    members,
  )

  // A non-member must be refused, loudly. If this filtered to zero rows instead
  // of raising, a stranger's empty list would be indistinguishable from an empty
  // team.
  const strangerBlocked = await guest.evaluate(`
    const { supabase } = await import('/src/lib/supabase/client.ts')
    const { error } = await supabase.rpc('project_members_list', {
      p_project: '00000000-0000-0000-0000-000000000000',
    })
    return error ? 'refused' : 'ALLOWED'
  `)
  check('a non-member is refused the team list', strangerBlocked === 'refused', strangerBlocked)

  // --- the drift warning ----------------------------------------------------
  // The quiet, expensive failure: working in your own copy while your team is
  // elsewhere. Everything saves and syncs, and reaches nobody.
  console.log('==> Translator switches back to their own worksheet; the app must say so')
  await guest.evaluate(`
    const { switchToProject } = await import('/src/lib/sync/adopt.ts')
    await switchToProject(${JSON.stringify(guestOwnProject)})
    return true
  `)
  await guest.goto(APP_URL)
  const warned = await guest.until(
    `document.body.innerText.includes('working in your own worksheet')`,
    15000,
  )
  check('the drift warning appears when they are not in the team', warned.ok, 'no warning shown')

  const offersWayBack = await guest.evaluate(
    `return document.body.innerText.includes(${JSON.stringify(TEAM_NAME)})`,
  )
  check('and it names the team to go back to', offersWayBack === true, 'team not offered')

  // --- bringing earlier work into the team ------------------------------------
  // The workshop's missing move: days of solo answers must be able to become the
  // team's data. The guest is currently in their own starter (drift state) — the
  // exact person this is for. They answer there, then import it into the team,
  // and the facilitator must receive it.
  console.log('==> Translator imports their solo work into the team')
  const SOLO = `Pekerjaan lama ${stamp}`
  const importCounts = await guest.evaluate(`
    const { upsertEntry } = await import('/src/lib/storage/entries.ts')
    const { ensureActiveContext } = await import('/src/lib/storage/appState.ts')
    const { importProjectInto } = await import('/src/lib/team/importWork.ts')
    const own = await ensureActiveContext()
    // A REAL content node ('s1b.description', genre layer): the importer now
    // refuses nodes the worksheet cannot render, so a made-up id would be
    // (correctly) skipped rather than imported.
    await upsertEntry(own, 's1b.description', 'genre', { text: ${JSON.stringify(SOLO)} })
    const counts = await importProjectInto(own.projectId, ${JSON.stringify(projectId)})
    const { syncEngine } = await import('/src/lib/sync/engine.ts')
    syncEngine.syncNow()
    return JSON.stringify(counts)
  `)
  const ic = JSON.parse(importCounts)
  check('the import reports what it brought', ic.answers >= 1, importCounts)

  const importedArrives = await host.until(
    `(await (await import('/src/lib/storage/db.ts')).db.entries.filter(e => e.text === ${JSON.stringify(SOLO)} && e.project_id === ${JSON.stringify(projectId)}).count()) > 0`,
    20000,
  )
  check(`the facilitator receives the imported answer (${importedArrives.ms}ms)`, importedArrives.ok, 'not within 20s')

  // The solo starter's genre is a placeholder, so it must arrive as its own
  // labelled container — never merged into the team's unrelated "Untitled genre".
  const labelled = await host.evaluate(`
    const { db } = await import('/src/lib/storage/db.ts')
    const g = await db.genres.filter(g =>
      g.project_id === ${JSON.stringify(projectId)} && g.name.includes('(')).first()
    return g ? g.name : 'MISSING'
  `)
  check('placeholder-named work arrives as its own labelled genre', labelled !== 'MISSING', labelled)

  // --- one code does everything: a stranger with only the join code -----------
  console.log('==> Newcomer: no account, only the team code from the whiteboard')
  newcomerEmail = `newcomer-${stamp}@example.com`
  newcomer = await launch('newcomer')
  await newcomer.goto(`${APP_URL}teams/join?code=${encodeURIComponent(shared)}`)

  const gateShown = await newcomer.until(
    `document.body.innerText.includes('creates your account')`,
    15000,
  )
  check('the signed-out join link offers the one-code form', gateShown.ok, 'form absent')

  const createdRes = await newcomer.evaluate(`
    const { createAccount } = await import('/src/lib/supabase/signup.ts')
    const res = await createAccount({
      name: 'Newcomer', email: ${JSON.stringify(newcomerEmail)},
      password: 'newcomer-pw-99', confirm: 'newcomer-pw-99',
      code: ${JSON.stringify(shared)},
    })
    return JSON.stringify(res)
  `)
  check('the team join code creates the account', JSON.parse(createdRes).ok === true, createdRes)

  // Signed in now; the join page is the one joiner. Reload it and it must land
  // the newcomer INSIDE the team, pointed at the shared containers.
  await newcomer.goto(`${APP_URL}teams/join?code=${encodeURIComponent(shared)}`)
  const landed = await newcomer.until(
    `((await (await import('/src/lib/storage/db.ts')).db.meta.get('activeProjectId'))?.value) === ${JSON.stringify(projectId)}`,
    25000,
  )
  check(`the newcomer lands inside the team (${landed.ms}ms)`, landed.ok, 'never adopted the team project')

  const roster = await newcomer.evaluate(`
    const { listProjectMembers } = await import('/src/lib/sync/supabase/projects.ts')
    const rows = await listProjectMembers(${JSON.stringify(projectId)})
    return JSON.stringify(rows.map(r => r.email).sort())
  `)
  check('and appears on the team roster', roster.includes(newcomerEmail), roster)
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.message}`)
} finally {
  await host?.close()
  await guest?.close()
  await newcomer?.close()
  if (projectId) await acc.sql(`delete from public.shared_projects where project_id = '${projectId}'`)
  // The newcomer was created through the signup function, not the accounts
  // helper, so it needs its own cleanup.
  if (newcomerEmail) await acc.sql(`delete from auth.users where email = '${newcomerEmail}'`)
  await acc.destroy()
}

console.log(failures === 0 ? '\n    team gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
