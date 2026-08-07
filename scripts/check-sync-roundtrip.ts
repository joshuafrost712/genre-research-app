/**
 * End-to-end proof that a real write on one device reaches another.
 *
 *   npx vite-node scripts/check-sync-roundtrip.ts
 *
 * Unlike verify-team-sync.mjs, which exercises the database through raw HTTP,
 * this drives the ACTUAL client modules: outbox -> collapse -> push_records ->
 * pullProject -> mergeShards -> Dexie. It is the only check that would catch a
 * bug living between the schema and the UI, which is where most of them live.
 *
 * "Two devices" is one process wiping its IndexedDB and changing author id
 * between phases. That is exactly what the sync layer sees when you open the
 * app in a different browser, which is the symptom this whole build exists to
 * fix.
 *
 * Creates one throwaway account and deletes it, along with the project it made.
 */
import 'fake-indexeddb/auto'
import { db } from '../src/lib/storage/db'
import { trackUpsert } from '../src/lib/sync/outbox'
import { pushOutbox } from '../src/lib/sync/supabase/push'
import { pullProject, resetCursor } from '../src/lib/sync/supabase/pull'
import { supabase } from '../src/lib/supabase/client'
import type { Entry, Project } from '../src/lib/types'

const REF = process.env.PROJECT_REF ?? 'ckorlrchryswnnrmuctr'
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN is required (source ~/.claude/secrets/supabase.env).')
  process.exit(1)
}
if (!supabase) {
  console.error('Supabase is not configured; check .env has VITE_SUPABASE_URL and ANON_KEY.')
  process.exit(1)
}

const BASE = `https://${REF}.supabase.co`
let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
).json()
const SERVICE = keys.find((k: { name: string }) => k.name === 'service_role').api_key

const stamp = Date.now().toString(36)
const email = `roundtrip-${stamp}@example.com`
const password = `roundtrip-${stamp}-pw`

const created = await (
  await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
).json()

const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
if (signInError) {
  console.error('sign-in failed:', signInError.message)
  process.exit(1)
}

const PROJECT_ID = crypto.randomUUID()
const now = () => new Date().toISOString()

function project(): Project {
  return {
    id: PROJECT_ID,
    name: 'Round-trip project',
    languages: ['id'],
    team_members: [],
    scope: 'narrow',
    config_version: 1,
    is_sensitive: false,
    created_at: now(),
    updated_at: now(),
  } as Project
}

function entry(id: string, text: string): Entry {
  return {
    id,
    project_id: PROJECT_ID,
    node_id: '1a',
    genre_id: 'g1',
    cell_key: 'c1',
    text,
    source_language: 'id',
    routing_status: 'none',
    sync_status: 'local',
    created_at: now(),
    updated_at: now(),
  } as Entry
}

try {
  // ---------------------------------------------------------------- device A
  console.log('==> Device A: type an answer and push it')
  await db.meta.put({ key: 'syncAuthorId', value: 'device-a' })

  const p = project()
  await db.projects.put(p)
  await trackUpsert('projects', p)

  const e = entry('e-round-1', 'Saya menulis jawaban ini di Bali')
  await db.entries.put(e)
  await trackUpsert('entries', e)

  const { error: pubErr } = await supabase.rpc('create_shared_project', {
    p_project: PROJECT_ID,
    p_name: p.name,
  })
  check('A publishes the project', !pubErr, pubErr?.message)

  const pushed = await pushOutbox(new Set([PROJECT_ID]))
  check('A pushes its outbox', pushed.pushed >= 2, `pushed=${pushed.pushed}`)
  check('A outbox is drained', (await db.outbox.count()) === 0, `${await db.outbox.count()} left`)

  // ---------------------------------------------------------------- device B
  // A different browser: same account, empty local database, its own author id.
  console.log('==> Device B: a different browser, same account, empty database')
  await Promise.all([
    db.projects.clear(),
    db.entries.clear(),
    db.genres.clear(),
    db.focusTexts.clear(),
    db.worksheets.clear(),
    db.outbox.clear(),
    db.meta.clear(),
  ])
  await db.meta.put({ key: 'syncAuthorId', value: 'device-b' })
  await resetCursor(PROJECT_ID)

  check('B starts with nothing', (await db.entries.count()) === 0)

  const t0 = Date.now()
  const pulled = await pullProject(PROJECT_ID, 'device-b')
  const ms = Date.now() - t0

  check('B pulls rows', pulled.applied >= 2, `applied=${pulled.applied}`)
  check('B sees A as another device', pulled.authors.has('device-a'), [...pulled.authors].join(','))

  const arrived = await db.entries.get('e-round-1')
  check(
    'B has the answer A typed',
    arrived?.text === 'Saya menulis jawaban ini di Bali',
    JSON.stringify(arrived?.text),
  )
  check('B has the project row too', (await db.projects.get(PROJECT_ID))?.name === 'Round-trip project')
  check(`B pulled in under 5s (${ms}ms)`, ms < 5000)

  // ------------------------------------------------- B edits, A sees it back
  console.log('==> Device B edits; device A pulls the change back')
  const edited = { ...arrived!, text: 'Diedit oleh perangkat kedua', updated_at: now() }
  await db.entries.put(edited)
  await trackUpsert('entries', edited)
  const pushedB = await pushOutbox(new Set([PROJECT_ID]))
  check('B pushes its edit', pushedB.pushed >= 1, `pushed=${pushedB.pushed}`)

  await db.entries.clear()
  await db.outbox.clear()
  await resetCursor(PROJECT_ID)
  await db.meta.put({ key: 'syncAuthorId', value: 'device-a' })
  await pullProject(PROJECT_ID, 'device-a')
  check(
    'A now has B\'s edit, not its own older text',
    (await db.entries.get('e-round-1'))?.text === 'Diedit oleh perangkat kedua',
    JSON.stringify((await db.entries.get('e-round-1'))?.text),
  )

  // -------------------------------------- an unsynced project is not retried
  console.log('==> An unpublished project must not wedge the outbox')
  const localOnly = { ...project(), id: crypto.randomUUID(), name: 'Local only' }
  await db.projects.put(localOnly)
  await trackUpsert('projects', localOnly)
  check('a local-only write is queued', (await db.outbox.count()) > 0)
  await pushOutbox(new Set([PROJECT_ID]))
  check(
    'and is dropped rather than retried forever',
    (await db.outbox.count()) === 0,
    `${await db.outbox.count()} left`,
  )
} catch (err) {
  failures++
  console.log(`    FAIL harness error — ${(err as Error).message}`)
} finally {
  await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `delete from public.shared_projects where project_id = '${PROJECT_ID}'`,
    }),
  }).catch(() => {})
  await fetch(`${BASE}/auth/v1/admin/users/${created.id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {})
}

console.log(failures === 0 ? '\n    round trip OK' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
