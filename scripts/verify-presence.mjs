#!/usr/bin/env node
/**
 * Behavioural proof that the presence channel is visible to a team and closed to
 * everyone else, run against the LIVE project. Driven by scripts/enable-presence.sh.
 *
 * BOTH SIDES, IN ONE RUN, and that is the whole design. A private channel nobody
 * can join and a private channel everybody can join are indistinguishable from a
 * single vantage point: "no presence events" is what correct refusal looks like to
 * a stranger and what a broken transport looks like to a teammate. So every
 * assertion here is on OBSERVED state — this key appeared, that key did not — and
 * the member case runs beside the non-member case.
 *
 * Creates two throwaway accounts and deletes them at the end, including on
 * failure. Writes only to a project it invents.
 *
 *   node scripts/verify-presence.mjs          full suite
 *   node scripts/verify-presence.mjs --warm   only boot the Realtime tenant
 */
import { createClient } from '@supabase/supabase-js'

const REF = process.env.PROJECT_REF
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!REF || !PAT) {
  console.error('PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set.')
  process.exit(1)
}

const BASE = `https://${REF}.supabase.co`
const MGMT = 'https://api.supabase.com/v1'
const WARM_ONLY = process.argv.includes('--warm')

let failures = 0
let checks = 0

function check(name, ok, detail = '') {
  checks++
  if (ok) console.log(`    ok   ${name}`)
  else {
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

const sql = (query) =>
  mgmt(`/projects/${REF}/database/query`, { method: 'POST', body: JSON.stringify({ query }) })

const keys = await mgmt(`/projects/${REF}/api-keys?reveal=true`)
const ANON = keys.find((k) => k.name === 'anon').api_key
const SERVICE = keys.find((k) => k.name === 'service_role').api_key

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * A client signed in as one user, or an anonymous one.
 *
 * SIGN IN FOR REAL. Do not reach for `createClient(url, key, {accessToken: () =>
 * jwt})`: that option hands realtime a token-getter but the initial
 * `realtime.setAuth()` is fire-and-forget in supabase-js's constructor, so a
 * `subscribe()` on the next line can join before the token is set. The socket then
 * joins the private channel as anon and Realtime refuses it with exactly the
 * message a broken RLS policy produces. That cost an hour of chasing correct SQL,
 * and it is the whole reason this comment is here. A real session is also what the
 * app does, so the harness and the app now exercise the same path.
 */
async function clientFor(user) {
  const client = createClient(BASE, ANON)
  if (user) {
    const { error } = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    if (error) throw new Error(`sign in ${user.tag}: ${error.message}`)
  }
  return client
}

/**
 * Join a presence topic and report what happened. Never throws: a refusal is a
 * result, not an exception, and the point of the suite is to compare results.
 */
async function joinPresence(client, topic, tracked, { isPrivate = true, timeoutMs = 15_000 } = {}) {
  const channel = client.channel(topic, {
    config: { private: isPrivate, presence: { key: tracked?.key ?? 'anon' } },
  })
  // Registered BEFORE subscribe on purpose. realtime-js only sets
  // `presence_enabled` in the join payload when a presence binding exists (or
  // config.presence.enabled is literally true), so a channel that subscribes
  // first and binds later joins with presence off and receives nothing.
  channel.on('presence', { event: 'sync' }, () => {})

  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ state: 'TIMEOUT', err: null }), timeoutMs)
    channel.subscribe((state, err) => {
      if (state === 'SUBSCRIBED' || state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
        clearTimeout(timer)
        resolve({ state, err: err ? String(err.message ?? err) : null })
      }
    })
  })

  if (outcome.state === 'SUBSCRIBED' && tracked) {
    await channel.track({ nodeId: tracked.nodeId, at: new Date().toISOString() })
  }
  return {
    ...outcome,
    channel,
    keys: () => Object.keys(channel.presenceState()),
    stateFor: (key) => channel.presenceState()[key] ?? null,
    // Bounded, and only untracking a channel that actually joined. `untrack()` on
    // a channel sitting in CHANNEL_ERROR never settles, which hung an entire run
    // after every assertion had already passed.
    close: async () => {
      const work = (async () => {
        if (outcome.state === 'SUBSCRIBED') await channel.untrack().catch(() => {})
        await client.removeChannel(channel).catch(() => {})
      })()
      await Promise.race([work, sleep(5_000)])
    },
  }
}

/** Poll a predicate over presence state; presence sync is asynchronous. */
async function eventually(fn, { timeoutMs = 10_000, everyMs = 200 } = {}) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (fn()) return true
    await sleep(everyMs)
  }
  return false
}

/** The same, for a predicate that is itself a request. */
async function eventuallyAsync(fn, { timeoutMs = 60_000, everyMs = 2_000 } = {}) {
  const until = Date.now() + timeoutMs
  for (;;) {
    if (await fn().catch(() => false)) return true
    if (Date.now() >= until) return false
    await sleep(everyMs)
  }
}

// ---------------------------------------------------------------- warm-up mode
//
// Realtime's DB-side schema (realtime.messages and its daily partitions,
// realtime.topic()) is created by the Realtime service's own migrations, and those
// run when a client first connects rather than at project creation. A project
// whose app has never used realtime therefore has an EMPTY realtime schema and
// reports realtime UNHEALTHY, and the first private-channel join during the boot
// window fails with "MissingPartition" — which reads exactly like a broken
// authorization design. One public channel is enough to trigger it.
if (WARM_ONLY) {
  const anon = await clientFor(null)
  const warm = await joinPresence(anon, `warm-${Date.now().toString(36)}`, null, { isPrivate: false })
  console.log(`    public channel: ${warm.state}`)
  await warm.close().catch(() => {})

  const ready = await eventuallyAsync(async () => {
    const r = await sql(`select to_regclass('realtime.messages') is not null as ok,
                                to_regproc('realtime.topic')     is not null as fn`)
    return r[0]?.ok === true && r[0]?.fn === true
  })
  console.log(ready ? '    realtime.messages is present' : '    realtime.messages STILL missing')
  process.exit(ready ? 0 : 1)
}

// -------------------------------------------------------------- throwaway users
const stamp = Date.now().toString(36)
const users = []

async function makeUser(tag) {
  const email = `spec12-${tag}-${stamp}@example.com`
  const password = `spec12-${stamp}-${tag}-pw`
  const res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`create ${tag}: ${res.status} ${await res.text()}`)
  const { id } = await res.json()

  const tok = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!tok.ok) throw new Error(`signin ${tag}: ${tok.status} ${await tok.text()}`)
  const { access_token } = await tok.json()

  const u = { tag, id, email, password, jwt: access_token }
  users.push(u)
  return u
}

const rpc = async (user, fn, args) => {
  const res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${user.jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
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

async function cleanup(projectId) {
  if (projectId) {
    await sql(`delete from public.shared_projects where project_id = '${projectId}'`).catch(() => {})
  }
  for (const u of users) {
    await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).catch(() => {})
  }
}

let P = null
const open = []

try {
  const A = await makeUser('a')
  const B = await makeUser('b')

  P = crypto.randomUUID()
  const pub = await rpc(A, 'create_shared_project', { p_project: P, p_name: 'Spec 12 presence' })
  if (pub.status !== 200 || typeof pub.body !== 'string') {
    throw new Error(`could not publish a project: ${pub.status} ${JSON.stringify(pub.body)}`)
  }
  const joinCode = pub.body
  const TOPIC = `presence:${P}`

  // ------------------------------------------------- 1. a member gets in and is seen
  const a = await joinPresence(await clientFor(A), TOPIC, { key: A.id, nodeId: 's1.setting' })
  open.push(a)
  check('1a  a member subscribes to the team topic', a.state === 'SUBSCRIBED', `${a.state} ${a.err ?? ''}`)
  check(
    '1b  ...and their own tracked state arrives',
    await eventually(() => a.keys().includes(A.id)),
    `keys=${JSON.stringify(a.keys())}`,
  )

  // --------------------------------------- 2. a non-member is refused, on the same topic
  const bBefore = await joinPresence(await clientFor(B), TOPIC, { key: B.id, nodeId: 's1.setting' })
  open.push(bBefore)
  check(
    '2a  a NON-member is refused the same topic',
    bBefore.state === 'CHANNEL_ERROR',
    `${bBefore.state} ${bBefore.err ?? ''}`,
  )
  check(
    '2b  ...and the refusal names authorization, not the transport',
    /unauthor|permission/i.test(bBefore.err ?? ''),
    `err=${bBefore.err}`,
  )
  check(
    '2c  ...and the member is STILL subscribed (so 2a is denial, not an outage)',
    a.state === 'SUBSCRIBED' && a.keys().includes(A.id),
    `keys=${JSON.stringify(a.keys())}`,
  )
  check(
    '2d  ...and the refused stranger never appeared in the member\'s state',
    !a.keys().includes(B.id),
    `keys=${JSON.stringify(a.keys())}`,
  )
  await bBefore.close().catch(() => {})

  // --------------------------------- 3. anon (the public key alone) is refused too
  const anonTry = await joinPresence(await clientFor(null), TOPIC, { key: 'anon-intruder', nodeId: 'x' })
  open.push(anonTry)
  check(
    '3   the anon key alone cannot join the team topic',
    anonTry.state === 'CHANNEL_ERROR',
    `${anonTry.state} ${anonTry.err ?? ''}`,
  )
  await anonTry.close().catch(() => {})

  // ------------------------------------------ 4. a malformed topic fails closed
  const junk = await joinPresence(await clientFor(A), 'presence:not-a-uuid', { key: A.id, nodeId: 'x' })
  open.push(junk)
  check(
    '4a  a topic that is not presence:<uuid> is refused',
    junk.state === 'CHANNEL_ERROR',
    `${junk.state} ${junk.err ?? ''}`,
  )
  check(
    '4b  ...by denial, not by a raised cast error',
    !/invalid input syntax|invalid_text_representation/i.test(junk.err ?? ''),
    `err=${junk.err}`,
  )
  await junk.close().catch(() => {})

  // ----------------------------------- 5. once B joins the team, both see each other
  const joined = await rpc(B, 'join_project', { p_code: joinCode })
  check('5a  B joins the team by code', joined.status === 200 && joined.body?.[0]?.project_id === P)

  const b = await joinPresence(await clientFor(B), TOPIC, { key: B.id, nodeId: 's1.performers' })
  open.push(b)
  check('5b  the new member now subscribes', b.state === 'SUBSCRIBED', `${b.state} ${b.err ?? ''}`)
  check(
    '5c  B sees A, on the node A is actually on',
    await eventually(() => b.stateFor(A.id)?.some((e) => e.nodeId === 's1.setting')),
    `A state as seen by B = ${JSON.stringify(b.stateFor(A.id))}`,
  )
  check(
    '5d  A sees B, on the node B is actually on',
    await eventually(() => a.stateFor(B.id)?.some((e) => e.nodeId === 's1.performers')),
    `B state as seen by A = ${JSON.stringify(a.stateFor(B.id))}`,
  )

  // -------------------------------- 6. closing the tab removes the dot, promptly
  await b.close()
  check(
    '6   B\'s presence disappears from A once B leaves',
    await eventually(() => !a.keys().includes(B.id)),
    `keys=${JSON.stringify(a.keys())}`,
  )

  await a.close()
} catch (err) {
  failures++
  console.log(`    FAIL harness error — ${err.message}`)
} finally {
  for (const c of open) await c.close().catch(() => {})
  await cleanup(P)
}

console.log(`\n    ${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
