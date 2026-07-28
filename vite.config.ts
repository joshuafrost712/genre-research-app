import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Base path is host-configurable: '/' for Cloudflare/Netlify/custom domains,
// '/<repo>/' for GitHub Project Pages. Set VITE_BASE at build time.
const base = process.env.VITE_BASE || '/'

// Dev-only endpoint backing the in-app feedback tools (src/devfeedback). It
// writes each submitted batch to feedback/incoming/<name>.md in the repo so
// Claude can read it next session. Exists only in `vite dev`, never in a build.
function feedbackInbox(): Plugin {
  return {
    name: 'genre-feedback-inbox',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url?.split('?')[0].endsWith('/__feedback')) return next()
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            const { filename, markdown } = JSON.parse(body) as { filename?: string; markdown?: string }
            const safe = basename(filename ?? 'feedback.md').replace(/[^\w.-]/g, '_')
            const name = safe.endsWith('.md') ? safe : `${safe}.md`
            const dir = join(process.cwd(), 'feedback', 'incoming')
            mkdirSync(dir, { recursive: true })
            writeFileSync(join(dir, name), markdown ?? '')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ path: `feedback/incoming/${name}` }))
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: String(err) }))
          }
        })
      })
    },
  }
}

// Dev-only endpoint for edit-in-place (spec 10 WP9): applies a structured
// {nodeId, field, oldText, newText} edit to src/content/guide-content.json.
// The old text must match the file's current value (409 otherwise), so a stale
// page can never clobber a newer edit. Never bumps the content version —
// that stays a deliberate, per-release decision.
function contentEditEndpoint(): Plugin {
  const EDITABLE_FIELDS = new Set(['label', 'guidance', 'footnote', 'example', 'help'])
  return {
    name: 'genre-content-edit',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url?.split('?')[0].endsWith('/__content-edit')) return next()
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const reply = (code: number, payload: object) => {
            res.statusCode = code
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
          }
          try {
            const { nodeId, field, oldText, newText } = JSON.parse(body) as {
              nodeId?: string
              field?: string
              oldText?: string
              newText?: string
            }
            if (!nodeId || !field || !EDITABLE_FIELDS.has(field) || !newText?.trim()) {
              return reply(400, { error: 'nodeId, an editable field, and non-empty newText are required' })
            }
            const file = join(process.cwd(), 'src', 'content', 'guide-content.json')
            const content = JSON.parse(readFileSync(file, 'utf8')) as {
              sections: Array<Record<string, unknown>>
              chrome?: Array<Record<string, unknown>>
            }
            let target: Record<string, unknown> | null = null
            const walk = (n: Record<string, unknown>) => {
              if (n.id === nodeId) target = n
              for (const child of (n.children as Array<Record<string, unknown>> | undefined) ?? []) walk(child)
            }
            for (const s of [...content.sections, ...(content.chrome ?? [])]) walk(s)
            if (!target) return reply(404, { error: `node ${nodeId} not found` })
            const current = (target as Record<string, unknown>)[field]
            if ((current ?? '') !== (oldText ?? '')) {
              return reply(409, { error: 'text changed since the page loaded — reload and retry' })
            }
            ;(target as Record<string, unknown>)[field] = newText.trim()
            writeFileSync(file, JSON.stringify(content, null, 2) + '\n')
            reply(200, { ok: true })
          } catch (err) {
            reply(400, { error: String(err) })
          }
        })
      })
    },
  }
}

// Dev-only endpoint for reviewing TRANSLATIONS in place, the counterpart to
// contentEditEndpoint above. Writes {key: translation} into
// src/content/translations/<locale>.json.
//
// Two guards that the English-side endpoint does not need:
//  - Interpolation tokens ({genre}, {passage}) present in the English must survive
//    into the translation, or the user reads a sentence with a hole in it. 70 of
//    the worksheet's 269 strings carry a token, so this is a live hazard.
//  - The English source's hash is recorded alongside the translation, so
//    `npm run i18n:report` can flag translations whose original was later
//    re-worded. `sourceText` comes from the client (which has it from
//    findSourceNode) rather than being resolved here, so the key scheme stays
//    defined in exactly one place: src/lib/i18n/keys.ts.
function translationEditEndpoint(): Plugin {
  const TOKENS = ['{genre}', '{passage}']
  return {
    name: 'genre-translation-edit',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url?.split('?')[0].endsWith('/__translation-edit')) {
          return next()
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          const reply = (code: number, payload: object) => {
            res.statusCode = code
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
          }
          try {
            const { locale, key, sourceText, oldText, newText } = JSON.parse(body) as {
              locale?: string
              key?: string
              sourceText?: string
              oldText?: string
              newText?: string
            }
            // Whitelist the locale: it becomes a filename.
            if (!locale || !/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
              return reply(400, { error: 'a valid locale code is required' })
            }
            if (!key || !/^[\w.$-]+$/.test(key)) return reply(400, { error: 'a valid key is required' })
            if (!newText?.trim()) return reply(400, { error: 'newText must be non-empty' })

            const lost = TOKENS.filter((t) => (sourceText ?? '').includes(t) && !newText.includes(t))
            if (lost.length) {
              return reply(400, { error: `translation must keep ${lost.join(' and ')} verbatim` })
            }

            const file = join(process.cwd(), 'src', 'content', 'translations', `${locale}.json`)
            let catalogue: Record<string, unknown> = {}
            try {
              catalogue = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
            } catch {
              catalogue = {} // first translation for this locale
            }
            const current = typeof catalogue[key] === 'string' ? (catalogue[key] as string) : ''
            if (current !== (oldText ?? '')) {
              return reply(409, { error: 'translation changed since the page loaded — reload and retry' })
            }

            catalogue[key] = newText.trim()
            if (typeof sourceText === 'string') {
              const hashes = (catalogue.$sourceHashes ?? {}) as Record<string, string>
              hashes[key] = createHash('sha256').update(sourceText.trim()).digest('hex').slice(0, 12)
              catalogue.$sourceHashes = hashes
            }
            // Keep $-prefixed metadata first, then translations sorted, so review
            // diffs stay readable.
            const meta = Object.entries(catalogue).filter(([k]) => k.startsWith('$'))
            const rest = Object.entries(catalogue)
              .filter(([k]) => !k.startsWith('$'))
              .sort(([a], [b]) => a.localeCompare(b))
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, `${JSON.stringify(Object.fromEntries([...meta, ...rest]), null, 2)}\n`)
            reply(200, { ok: true })
          } catch (err) {
            reply(400, { error: String(err) })
          }
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    feedbackInbox(),
    contentEditEndpoint(),
    translationEditEndpoint(),
    react(),
    tailwindcss(),
    VitePWA({
      // Auto-update: a new deploy activates on the next load without a manual
      // "reload to update" prompt. With 'prompt' (and no prompt UI wired) a
      // returning visitor's service worker stayed in the waiting state forever,
      // serving a stale cached build — so the live site could look nothing like
      // the current one. skipWaiting + clientsClaim below make the new worker
      // take over immediately.
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Local Genres Research',
        short_name: 'Genres',
        description:
          'Guided local-genres research for translating a focus text into a culturally relevant genre.',
        theme_color: '#1f2937',
        background_color: '#ffffff',
        display: 'standalone',
        // start_url / scope honor the base so the installed app opens correctly
        // whether hosted at the domain root or a project-pages subpath.
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // pdfmake ships its fonts as one ~2 MB virtual-file-system chunk; raise
        // the precache ceiling so PDF export still works fully offline once
        // installed.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Self-healing updates: delete previous-revision precaches, and let a
        // newly deployed worker take over open pages immediately instead of
        // waiting for every tab to close (the stall that froze users on old
        // builds). Only touches Cache Storage (static assets) — never the Dexie
        // IndexedDB where users' entered data lives.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      // Let the PWA work while developing so install/offline can be tested early.
      devOptions: { enabled: true },
    }),
  ],
})
