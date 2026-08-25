/**
 * Drive Chrome over the DevTools Protocol, using Node's built-in WebSocket.
 *
 * Shared by the sync check scripts. No Playwright dependency and no browser
 * download: these run wherever Chrome is already installed, which matters
 * because they are meant to be run on the machine that is about to fly to Bali,
 * not only in CI.
 *
 * Each `launch()` gets its own temporary profile, so two of them share nothing:
 * separate IndexedDB, separate localStorage, separate session. That is precisely
 * the "Safari and Chrome held two different sets of answers" situation these
 * checks exist to prove is fixed.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch(label, { headful = process.env.HEADFUL === '1' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `genre-${label}-`))
  const port = 9300 + Math.floor(Math.random() * 600)
  const proc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      ...(headful ? [] : ['--headless=new']),
      '--no-first-run',
      '--no-default-browser-check',
      // A headless tab is "occluded", and Chrome throttles timers in occluded
      // tabs. The sync engine's poll is a timer, so without these the checks
      // measure Chrome's power saving rather than the app.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
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
    if (exceptionDetails) {
      throw new Error(`${label}: ${exceptionDetails.exception?.description ?? 'eval failed'}`)
    }
    return result.value
  }

  return {
    label,
    evaluate,

    async goto(url, settleMs = 2500) {
      await send('Page.navigate', { url })
      await sleep(settleMs)
    },

    /** Poll an expression until truthy. Returns {ok, value, ms}. */
    async until(expression, timeoutMs, everyMs = 300) {
      const started = Date.now()
      for (;;) {
        const v = await evaluate(`return (${expression})`)
        if (v) return { ok: true, value: v, ms: Date.now() - started }
        if (Date.now() - started > timeoutMs) return { ok: false, value: v, ms: Date.now() - started }
        await sleep(everyMs)
      }
    },

    /**
     * Pretend to be a phone.
     *
     * Most of the people this app is built for are on one, and the header is
     * where the team indicator lives — the surface most likely to be squeezed.
     * A layout claim about mobile that was checked at 1200px is not a claim.
     */
    async emulate({ width = 390, height = 844, scale = 2 } = {}) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: scale,
        mobile: width < 768,
      })
    },

    /**
     * Make the page behave as though its window has focus.
     *
     * Headless Chrome treats every page as unfocused, and an unfocused page does
     * not fire focus/blur (nor focusin/focusout). Any check about what happens
     * when a field loses focus — autosave-on-blur, above all — silently measures
     * nothing without this: the blur() call succeeds, activeElement changes, and
     * no handler ever runs. Opt in per check rather than by default, so the
     * existing checks keep the browser behaviour they were written against.
     */
    async focusEmulation(enabled = true) {
      await send('Emulation.setFocusEmulationEnabled', { enabled })
    },

    /** PNG to disk, so an appearance claim can be looked at rather than asserted. */
    async screenshot(path, { fullPage = false } = {}) {
      const { data } = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: fullPage,
      })
      writeFileSync(path, Buffer.from(data, 'base64'))
      return path
    },

    /** Plant the session supabase-js would have written, for the reload path. */
    async signIn(projectRef, session) {
      await evaluate(
        `localStorage.setItem(${JSON.stringify(`sb-${projectRef}-auth-token`)}, ${JSON.stringify(JSON.stringify(session))}); return 1`,
      )
    },

    /** Read a Dexie table through raw IndexedDB, so minified builds work too. */
    readTable(name) {
      return evaluate(`
        return await new Promise((resolve) => {
          const req = indexedDB.open('genre-research')
          req.onerror = () => resolve([])
          req.onsuccess = () => {
            const dbh = req.result
            if (!dbh.objectStoreNames.contains(${JSON.stringify(name)})) return resolve([])
            const all = dbh.transaction(${JSON.stringify(name)}, 'readonly')
              .objectStore(${JSON.stringify(name)}).getAll()
            all.onsuccess = () => resolve(all.result)
            all.onerror = () => resolve([])
          }
        })
      `)
    },

    async close() {
      try {
        ws.close()
      } catch {
        /* already gone */
      }
      proc.kill('SIGKILL')
      // Chrome unlinks its profile lock asynchronously, so an immediate rmSync
      // races it and throws ENOTEMPTY after every check has already passed.
      await sleep(500)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* the OS reaps temp dirs; a leftover must not fail the run */
      }
    },
  }
}

/** Throwaway accounts against the live project, cleaned up by `destroy()`. */
export async function accounts(ref, pat) {
  const base = `https://${ref}.supabase.co`
  const keys = await (
    await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
      headers: { Authorization: `Bearer ${pat}` },
    })
  ).json()
  const service = keys.find((k) => k.name === 'service_role').api_key
  const anon = keys.find((k) => k.name === 'anon').api_key
  const made = []

  return {
    base,
    anon,
    service,

    async create(tag) {
      const stamp = Date.now().toString(36)
      const email = `${tag}-${stamp}@example.com`
      const password = `${tag}-${stamp}-pw`
      const res = await fetch(`${base}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: service,
          Authorization: `Bearer ${service}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, email_confirm: true }),
      })
      if (!res.ok) throw new Error(`create ${tag}: ${res.status} ${await res.text()}`)
      const { id } = await res.json()
      const session = await (
        await fetch(`${base}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: anon, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })
      ).json()
      const user = { id, email, session }
      made.push(user)
      return user
    },

    /** PostgREST as one of these users. */
    rest(user, path, init = {}) {
      return fetch(`${base}/rest/v1${path}`, {
        ...init,
        headers: {
          apikey: anon,
          Authorization: `Bearer ${user.session.access_token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      })
    },

    async sql(query) {
      await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      }).catch(() => {})
    },

    async destroy() {
      for (const u of made) {
        await fetch(`${base}/auth/v1/admin/users/${u.id}`, {
          method: 'DELETE',
          headers: { apikey: service, Authorization: `Bearer ${service}` },
        }).catch(() => {})
      }
    },
  }
}
