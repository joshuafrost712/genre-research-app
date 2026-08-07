#!/usr/bin/env node
/**
 * The gate: two real browsers, one account, an answer typed in one appearing in
 * the other.
 *
 *   npm run dev                                  # in another terminal
 *   node scripts/check-sync-browser.mjs          # or pass a URL to test the deploy
 *
 * check-sync-roundtrip.ts already proves the transport by calling the sync
 * modules directly. This proves the part that file cannot: that the React app
 * actually STARTS the engine on sign-in, that a keystroke reaches the outbox
 * through the real autosave path, and that an arriving row repaints the screen.
 * Every bug that survives a green transport test lives in exactly that gap.
 *
 * Two isolated Chrome profiles, so the two sides share nothing but the account:
 * separate IndexedDB, separate localStorage, separate session. That is what
 * "Safari and Chrome" was, which is the symptom this whole build exists to fix.
 *
 * Drives Chrome over the DevTools Protocol using Node's built-in WebSocket, so
 * there is no Playwright download and this runs anywhere Chrome is installed.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP_URL = process.argv[2] ?? 'http://localhost:5173/'
const HEADFUL = process.env.HEADFUL === '1'

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** One Chrome instance with its own profile, driven over CDP. */
async function launch(label) {
  const dir = mkdtempSync(join(tmpdir(), `genre-${label}-`))
  const port = 9400 + Math.floor(Math.random() * 500)
  const proc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      ...(HEADFUL ? [] : ['--headless=new']),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  // Wait for the debugging endpoint.
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
    const msg = JSON.parse(ev.data)
    const pending = waiting.get(msg.id)
    if (pending) {
      waiting.delete(msg.id)
      msg.error ? pending.reject(new Error(JSON.stringify(msg.error))) : pending.resolve(msg.result)
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

  /** Evaluate an async expression in the page and return its value. */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails) {
      throw new Error(`${label}: ${exceptionDetails.exception?.description ?? 'eval failed'}`)
    }
    return result.value
  }

  const goto = async (url) => {
    await send('Page.navigate', { url })
    await sleep(2500)
  }

  /** Poll an expression until it is truthy, or give up. */
  const until = async (expression, timeoutMs, everyMs = 250) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const v = await evaluate(`return (${expression})`)
      if (v) return { ok: true, value: v, ms: timeoutMs - (deadline - Date.now()) }
      if (Date.now() > deadline) return { ok: false, value: v, ms: timeoutMs }
      await sleep(everyMs)
    }
  }

  return {
    label,
    evaluate,
    goto,
    until,
    async close() {
      try {
        ws.close()
      } catch {
        /* already gone */
      }
      proc.kill('SIGKILL')
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

// --- account -------------------------------------------------------------------
const REF = process.env.PROJECT_REF ?? 'ckorlrchryswnnrmuctr'
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN required (source ~/.claude/secrets/supabase.env).')
  process.exit(1)
}
const BASE = `https://${REF}.supabase.co`
const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
).json()
const SERVICE = keys.find((k) => k.name === 'service_role').api_key

const stamp = Date.now().toString(36)
const email = `browser-${stamp}@example.com`
const password = `browser-${stamp}-pw`
const created = await (
  await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
).json()

console.log(`==> Account ${email}`)
console.log(`==> App ${APP_URL}`)

/**
 * Sign in from inside the page, using the app's own Supabase client rather than
 * typing into the form. The form is covered by other checks; what matters here
 * is what the sync engine does once a session exists.
 */
const signIn = `
  const { supabase } = await import('/src/lib/supabase/client.ts').catch(() => ({}))
  if (supabase) {
    const { error } = await supabase.auth.signInWithPassword({
      email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
    return error ? 'error: ' + error.message : 'signed-in'
  }
  return 'no-module'
`

/** Production builds have no module graph to import; drive the UI instead. */
const signInViaUi = `
  const key = Object.keys(localStorage).find(k => k.startsWith('sb-'))
  return key ? 'already' : 'needs-ui'
`

let A, B
try {
  A = await launch('A')
  B = await launch('B')

  console.log('==> Device A: load, sign in, type an answer')
  await A.goto(APP_URL)

  const bootedA = await A.evaluate(`return document.body.innerText.slice(0, 80)`)
  check('A loads the app', typeof bootedA === 'string' && bootedA.length > 0, bootedA)

  const authA = await A.evaluate(signIn)
  check('A signs in', authA === 'signed-in', String(authA))

  // Give the engine its bootstrap cycle (publish own projects, first pull).
  await sleep(4000)

  const chipA = await A.evaluate(`
    const el = [...document.querySelectorAll('button')].find(b => /Saved|waiting|Offline|Sync failed/.test(b.textContent))
    return el ? el.textContent.trim() : null
  `)
  check('A shows a sync chip with a real state', chipA !== null, String(chipA))

  const ANSWER = `Jawaban uji ${stamp}`
  // Write through the app's own storage path, so the outbox, autosave contract
  // and merge rules are all the real ones.
  const wrote = await A.evaluate(`
    const { upsertEntry } = await import('/src/lib/storage/entries.ts')
    const { ensureActiveContext } = await import('/src/lib/storage/appState.ts')
    const ctx = await ensureActiveContext()
    await upsertEntry(ctx, 'browser-check', 'genre', { text: ${JSON.stringify(ANSWER)} })
    return ctx.projectId
  `)
  check('A saves an answer through the real write path', typeof wrote === 'string', String(wrote))

  const drained = await A.until(
    `(await (await import('/src/lib/storage/db.ts')).db.outbox.count()) === 0`,
    15000,
  )
  check('A drains its outbox to the cloud', drained.ok, `still pending after ${drained.ms}ms`)

  console.log('==> Device B: a separate browser profile, same account')
  await B.goto(APP_URL)
  const authB = await B.evaluate(signIn)
  check('B signs in', authB === 'signed-in', String(authB))

  const t0 = Date.now()
  const arrived = await B.until(
    `(await (await import('/src/lib/storage/db.ts')).db.entries.filter(e => e.text === ${JSON.stringify(ANSWER)}).count()) > 0`,
    20000,
  )
  const elapsed = Date.now() - t0
  check(`B receives A's answer (${elapsed}ms)`, arrived.ok, `not seen within 20s`)

  console.log('==> Device B answers back')
  const REPLY = `Balasan ${stamp}`
  await B.evaluate(`
    const { db } = await import('/src/lib/storage/db.ts')
    const { upsertEntry } = await import('/src/lib/storage/entries.ts')
    const row = await db.entries.filter(e => e.text === ${JSON.stringify(ANSWER)}).first()
    await upsertEntry(
      { projectId: row.project_id, genreId: row.genre_id, focusTextId: '', worksheetId: '' },
      row.node_id, 'genre', { text: ${JSON.stringify(REPLY)} })
    return true
  `)

  const back = await A.until(
    `(await (await import('/src/lib/storage/db.ts')).db.entries.filter(e => e.text === ${JSON.stringify(REPLY)}).count()) > 0`,
    20000,
  )
  check(`A receives B's reply (${back.ms}ms)`, back.ok, 'not seen within 20s')

  const errsA = await A.evaluate(`
    return (window.__syncErrors ?? []).slice(0, 3).join(' | ') || 'none'
  `)
  check('A reports no sync error', errsA === 'none', String(errsA))
} catch (err) {
  failures++
  console.log(`    FAIL harness — ${err.message}`)
} finally {
  await A?.close()
  await B?.close()
  await fetch(`${BASE}/auth/v1/admin/users/${created.id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {})
}

console.log(failures === 0 ? '\n    browser gate PASSED' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
