#!/usr/bin/env node
/**
 * Behavioural proof that cloud sync is isolated and converges, run against the
 * LIVE project. Driven by scripts/enable-team-sync.sh.
 *
 * Every assertion is on PRESENT/ABSENT STATE, never on an exception being thrown.
 * That is deliberate. RLS denial in Postgres is silent filtering: a policy that
 * refuses you returns zero rows with a 200, not an error. A suite that asserted
 * "this throws" would pass just as happily against a database that was simply
 * empty, or against a policy that denied everyone including the owner. Asking
 * "is the row there?" cannot be fooled that way.
 *
 * Creates three throwaway accounts and deletes them at the end, including on
 * failure. Writes only to projects it invents.
 */
const REF = process.env.PROJECT_REF
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!REF || !PAT) {
  console.error('PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set.')
  process.exit(1)
}

const BASE = `https://${REF}.supabase.co`
const MGMT = 'https://api.supabase.com/v1'

let failures = 0
let checks = 0

function check(name, ok, detail = '') {
  checks++
  if (ok) {
    console.log(`    ok   ${name}`)
  } else {
    failures++
    console.log(`    FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function mgmt(path, init = {}) {
  const res = await fetch(`${MGMT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

/** Run SQL as the database owner (used only for privilege introspection). */
async function sql(query) {
  return mgmt(`/projects/${REF}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
}

// --- keys ---------------------------------------------------------------------
const keys = await mgmt(`/projects/${REF}/api-keys?reveal=true`)
const ANON = keys.find((k) => k.name === 'anon').api_key
const SERVICE = keys.find((k) => k.name === 'service_role').api_key

// --- throwaway accounts --------------------------------------------------------
const stamp = Date.now().toString(36)
const users = []

async function makeUser(tag) {
  const email = `verify-${tag}-${stamp}@example.com`
  const password = `verify-${stamp}-${tag}-pw`
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`create ${tag}: ${res.status} ${await res.text()}`)
  const { id } = await res.json()

  const tokRes = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!tokRes.ok) throw new Error(`signin ${tag}: ${tokRes.status} ${await tokRes.text()}`)
  const { access_token } = await tokRes.json()

  const u = { tag, id, email, jwt: access_token }
  users.push(u)
  return u
}

/** PostgREST as a signed-in user. Returns {status, body}; never throws on 4xx. */
async function as(user, path, init = {}) {
  const res = await fetch(`${BASE}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${user.jwt}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const rpc = (user, fn, args) =>
  as(user, `/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

const selectRecords = (user, projectId) =>
  as(user, `/sync_records?project_id=eq.${projectId}&select=record_id,updated_at,data`)

function record(id, text, updatedAt, author = 'dev-a') {
  return {
    tbl: 'entries',
    record_id: id,
    op: 'upsert',
    updated_at: updatedAt,
    author_id: author,
    data: { id, text, updated_at: updatedAt },
  }
}

const T1 = '2026-08-06T10:00:00.000Z'
const T2 = '2026-08-06T11:00:00.000Z'
const T0 = '2026-08-06T09:00:00.000Z'

const uuid = () => crypto.randomUUID()

async function cleanup() {
  for (const u of users) {
    await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).catch(() => {})
  }
}

try {
  const A = await makeUser('a')
  const B = await makeUser('b')
  const C = await makeUser('c')

  // ---------------------------------------------------------------- 1. own data
  const P = uuid()
  const pub = await rpc(A, 'create_shared_project', { p_project: P, p_name: 'Verify A' })
  check('1a  A publishes a project', pub.status === 200 && typeof pub.body === 'string', JSON.stringify(pub.body))
  const code = pub.body

  const pushed = await rpc(A, 'push_records', { p_project: P, p_records: [record('r1', 'hello', T1)] })
  check('1b  A pushes r1', pushed.status === 200 && pushed.body === 1, JSON.stringify(pushed.body))

  let rows = await selectRecords(A, P)
  check('1c  A sees r1', Array.isArray(rows.body) && rows.body.some((r) => r.record_id === 'r1'))

  // -------------------------------------------------- 2. a non-member sees zero
  rows = await selectRecords(B, P)
  check(
    '2   B (not a member) gets exactly 0 rows, not an error',
    rows.status === 200 && Array.isArray(rows.body) && rows.body.length === 0,
    `status=${rows.status} body=${JSON.stringify(rows.body)}`,
  )

  // ------------------------------------- 3. a non-member's write does not land
  const denied = await rpc(B, 'push_records', { p_project: P, p_records: [record('r2', 'intruder', T2, 'dev-b')] })
  rows = await selectRecords(A, P)
  check(
    '3a  B\'s push left no row behind (the real assertion)',
    Array.isArray(rows.body) && !rows.body.some((r) => r.record_id === 'r2'),
  )
  check('3b  ...and it was refused loudly, not silently', denied.status >= 400, `status=${denied.status}`)

  // ------------------------------------------------------------- 4/5. joining
  const joined = await rpc(B, 'join_project', { p_code: code })
  check('4a  B joins by code', joined.status === 200 && joined.body?.[0]?.project_id === P, JSON.stringify(joined.body))

  rows = await selectRecords(B, P)
  check('4b  B now sees A\'s r1', Array.isArray(rows.body) && rows.body.some((r) => r.record_id === 'r1'))

  await rpc(B, 'push_records', { p_project: P, p_records: [record('r2', 'from B', T2, 'dev-b')] })
  rows = await selectRecords(A, P)
  check(
    '5   A sees B\'s r2',
    Array.isArray(rows.body) && rows.body.find((r) => r.record_id === 'r2')?.data?.text === 'from B',
  )

  // ----------------------------------------------------- 6/7. last-write-wins
  await rpc(A, 'push_records', { p_project: P, p_records: [record('r1', 'STALE', T0)] })
  rows = await selectRecords(A, P)
  check(
    '6   an older updated_at does NOT overwrite',
    rows.body.find((r) => r.record_id === 'r1')?.data?.text === 'hello',
    JSON.stringify(rows.body.find((r) => r.record_id === 'r1')),
  )

  await rpc(A, 'push_records', { p_project: P, p_records: [record('r1', 'newer', T2)] })
  rows = await selectRecords(A, P)
  check(
    '7   a newer updated_at DOES overwrite',
    rows.body.find((r) => r.record_id === 'r1')?.data?.text === 'newer',
  )

  // ------------------------------------------------ 8. cross-project isolation
  const P2 = uuid()
  await rpc(C, 'create_shared_project', { p_project: P2, p_name: 'Verify C' })
  await rpc(C, 'push_records', { p_project: P2, p_records: [record('c1', 'C only', T1, 'dev-c')] })

  rows = await selectRecords(A, P2)
  check(
    '8a  A gets 0 rows for C\'s project',
    rows.status === 200 && Array.isArray(rows.body) && rows.body.length === 0,
    `body=${JSON.stringify(rows.body)}`,
  )
  const allA = await as(A, '/sync_records?select=record_id')
  check(
    '8b  ...and c1 is absent from everything A can see',
    Array.isArray(allA.body) && !allA.body.some((r) => r.record_id === 'c1'),
  )

  // ------------------------------------------------------------ 9. anon is blind
  const anonRes = await fetch(`${BASE}/rest/v1/sync_records?select=record_id`, {
    headers: { apikey: ANON },
  })
  const anonBody = await anonRes.json().catch(() => null)
  check(
    '9   the anon key alone sees 0 rows',
    !Array.isArray(anonBody) || anonBody.length === 0,
    `status=${anonRes.status} body=${JSON.stringify(anonBody)}`,
  )

  const anonPush = await fetch(`${BASE}/rest/v1/rpc/push_records`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_project: P, p_records: [record('anon1', 'anon', T2)] }),
  })
  rows = await selectRecords(A, P)
  check(
    '9b  anon push_records left no row behind',
    Array.isArray(rows.body) && !rows.body.some((r) => r.record_id === 'anon1'),
    `push status=${anonPush.status}`,
  )

  // -------------------------------------------------------- 10. grants by name
  const g = (
    await sql(`select
      has_function_privilege('anon','public.push_records(uuid,jsonb)','execute') a1,
      has_function_privilege('anon','public.join_project(text)','execute') a2,
      has_function_privilege('anon','public.create_shared_project(uuid,text)','execute') a3,
      has_function_privilege('anon','public.is_member(uuid)','execute') a4,
      has_table_privilege('anon','public.sync_records','insert') a5,
      has_table_privilege('authenticated','public.sync_records','insert') a6`)
  )[0]
  check('10  anon holds no execute or insert grant', !g.a1 && !g.a2 && !g.a3 && !g.a4 && !g.a5, JSON.stringify(g))
  check('10b authenticated cannot insert directly either', !g.a6)

  // ---------------------------------------------- 11. duplicate keys in one batch
  const dup = await rpc(A, 'push_records', {
    p_project: P,
    p_records: [record('r3', 'v1', T0), record('r3', 'v2', T1), record('r3', 'v3', T2)],
  })
  rows = await selectRecords(A, P)
  const r3 = rows.body.filter((r) => r.record_id === 'r3')
  check(
    '11  a batch with the same key three times succeeds, newest wins',
    dup.status === 200 && r3.length === 1 && r3[0].data?.text === 'v3',
    `status=${dup.status} rows=${JSON.stringify(r3)}`,
  )

  // ------------------------------------------------------- 12. round-trip speed
  const t0 = Date.now()
  await rpc(A, 'push_records', { p_project: P, p_records: [record('r4', 'timed', T2)] })
  let seen = false
  while (Date.now() - t0 < 5000 && !seen) {
    const r = await selectRecords(B, P)
    seen = Array.isArray(r.body) && r.body.some((x) => x.record_id === 'r4')
    if (!seen) await new Promise((r) => setTimeout(r, 150))
  }
  check('12  A\'s write is visible to B in under 5s', seen, `${Date.now() - t0}ms`)

  // ------------------------------------------------------------------ teardown
  await sql(`delete from public.shared_projects where project_id in ('${P}','${P2}')`)
} catch (err) {
  failures++
  console.log(`    FAIL harness error — ${err.message}`)
} finally {
  await cleanup()
}

console.log(`\n    ${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
