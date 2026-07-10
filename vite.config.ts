import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
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
            const safe = basename(filename ?? 'feedback.md').replace(/[^\w.\-]/g, '_')
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

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    feedbackInbox(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
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
      // pdfmake ships its fonts as one ~2 MB virtual-file-system chunk; raise the
      // precache ceiling so PDF export still works fully offline once installed.
      workbox: { maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      // Let the PWA work while developing so install/offline can be tested early.
      devOptions: { enabled: true },
    }),
  ],
})
