import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Base path is host-configurable: '/' for Cloudflare/Netlify/custom domains,
// '/<repo>/' for GitHub Project Pages. Set VITE_BASE at build time.
const base = process.env.VITE_BASE || '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
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
      // Let the PWA work while developing so install/offline can be tested early.
      devOptions: { enabled: true },
    }),
  ],
})
