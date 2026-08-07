#!/usr/bin/env node
/**
 * Verify the DEPLOYED build actually syncs.
 *
 *   node scripts/check-sync-live.mjs https://joshuafrost712.github.io/genre-research-app/
 *
 * check-sync-browser.mjs imports the app's own modules, which only exist under
 * `vite dev`. This one touches nothing the bundler could have renamed: it plants
 * a session in localStorage, reads Dexie through the raw IndexedDB API, and
 * checks the cloud side over REST from Node. So it works against a minified
 * production bundle, which is the only build anyone in Bali will ever run.
 *
 * It answers the question Joshua actually asked, in the direction that matters
 * most: work already in the account appears on a device that has never seen it.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.argv[2] ?? 'https://joshuafrost712.github.io/genre-research-app/'
const REF = process.env.PROJECT_REF ?? 'ckorlrchryswnnrmuctr'
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN required (source ~/.claude/secrets/supabase.env).')
  process.exit(1)
}
const BASE = `https://${REF}.supabase.co`

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch(label) {
  const dir = mkdtempSync(join(tmpdir(), `genre-live-${label}-`))
  const port = 9600 + Math.floor(Math.random() * 300)
  const proc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250)
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      wsUrl = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null
    } catch {
      /* not up yet */
    }
  }
  if (!wsUrl) throw new Error(`${label}: Chrome debug port never opened`)

  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  let nextId = 1
  const waiting = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    const p = waiting.get(m.id)
    if (p) {
      waiting.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      waiting.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (waiting.delete(id)) reject(new Error(`${label}: ${method} timed out`))
      }, 30_000)
    })
  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) throw new Error(`${label}: ${exceptionDetails.exception?.description}`)
    return result.value
  }
  const goto = async (url) => {
    await send('Page.navigate', { url })
    await sleep(3000)
  }
  const until = async (expr, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const v = await evaluate(`return (${expr})`)
      if (v) return { ok: true, value: v }
      if (Date.now() > deadline) return { ok: false, value: v }
      await sleep(400)
    }
  }
  return {
    evaluate,
    goto,
    until,
    async close() {
      try {
        ws.close()
      } catch {
        /* gone */
      }
      proc.kill('SIGKILL')
      // Chrome unlinks its profile lock asynchronously, so an immediate rmSync
      // races it and throws ENOTEMPTY after every check has already passed.
      await sleep(500)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* the OS will reap the temp dir; a leftover must not fail the run */
      }
    },
  }
}

/** Read a Dexie table through the raw IndexedDB API, immune to minification. */
const readTable = (name) => `
  return await new Promise((resolve) => {
    const req = indexedDB.open('genre-research')
    req.onerror = () => resolve([])
    req.onsuccess = () => {
      const dbh = req.result
      if (!dbh.objectStoreNames.contains(${JSON.stringify(name)})) return resolve([])
      const tx = dbh.transaction(${JSON.stringify(name)}, 'readonly')
      const all = tx.objectStore(${JSON.stringify(name)}).getAll()
      all.onsuccess = () => resolve(all.result)
      all.onerror = () => resolve([])
    }
  })
`

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
).json()
const SERVICE = keys.find((k) => k.name === 'service_role').api_key
const ANON = keys.find((k) => k.name === 'anon').api_key

const stamp = Date.now().toString(36)
const email = `live-${stamp}@example.com`
const password = `live-${stamp}-pw`
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
const session = await (
  await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
).json()

const rest = (path, init = {}) =>
  fetch(`${BASE}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

console.log(`==> App     ${APP_URL}`)
console.log(`==> Account ${email}`)

// Seed the account as if a first device had already done a day's work.
const PROJECT_ID = crypto.randomUUID()
const ANSWER = `Jawaban dari perangkat pertama ${stamp}`
const nowIso = new Date().toISOString()

await rest('/rpc/create_shared_project', {
  method: 'POST',
  body: JSON.stringify({ p_project: PROJECT_ID, p_name: 'Bali live check' }),
})
await rest('/rpc/push_records', {
  method: 'POST',
  body: JSON.stringify({
    p_project: PROJECT_ID,
    p_records: [
      {
        tbl: 'projects',
        record_id: PROJECT_ID,
        op: 'upsert',
        updated_at: nowIso,
        author_id: 'seed-device',
        data: {
          id: PROJECT_ID,
          name: 'Bali live check',
          languages: ['id'],
          team_members: [],
          scope: 'narrow',
          config_version: 1,
          is_sensitive: false,
          created_at: nowIso,
          updated_at: nowIso,
        },
      },
      {
        tbl: 'entries',
        record_id: `live-entry-${stamp}`,
        op: 'upsert',
        updated_at: nowIso,
        author_id: 'seed-device',
        data: {
          id: `live-entry-${stamp}`,
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
        },
      },
    ],
  }),
})
console.log('==> Seeded the account with a project and one answer')

let page
try {
  page = await launch('live')

  await page.goto(APP_URL)
  const boot = await page.evaluate(`return document.body.innerText.slice(0, 60)`)
  check('the deployed app loads', typeof boot === 'string' && boot.length > 0, String(boot))

  const fresh = await page.evaluate(readTable('entries'))
  check('this browser has never seen the app', Array.isArray(fresh) && fresh.length === 0, `${fresh?.length} entries`)

  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(`sb-${REF}-auth-token`)}, ${JSON.stringify(JSON.stringify(session))}); return 1`,
  )
  await page.goto(APP_URL)

  const chip = await page.evaluate(`
    const el = [...document.querySelectorAll('button')].find(b => /Saved|waiting|Offline|Sync failed/.test(b.textContent))
    return el ? el.textContent.trim() : null
  `)
  check('the sync chip renders in the deployed header', chip !== null, String(chip))

  const t0 = Date.now()
  const got = await page.until(
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
  check(`the account's existing work arrives on this device (${Date.now() - t0}ms)`, got.ok, 'not within 25s')

  const projects = await page.evaluate(readTable('projects'))
  check(
    'the project came down too, not just the answer',
    Array.isArray(projects) && projects.some((p) => p.id === PROJECT_ID),
    JSON.stringify(projects?.map((p) => p.name)),
  )

  // The device should now be POINTED at the synced project, not its own starter.
  const meta = await page.evaluate(readTable('meta'))
  const activeId = meta?.find((m) => m.key === 'activeProjectId')?.value
  check(
    'and the app adopted it instead of showing its own empty starter',
    activeId === PROJECT_ID,
    `activeProjectId=${activeId}`,
  )
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.message}`)
} finally {
  await page?.close()
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

console.log(failures === 0 ? '\n    live gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
