import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Self-healing updates: periodically ask the active service worker to check for
// a newer deploy, so even a tab left open for hours picks it up on its own. The
// worker (registerType: 'autoUpdate' + skipWaiting/clientsClaim) then activates
// and reloads the page. This does not re-register — it only triggers update() —
// and touches only the asset cache, never the IndexedDB with users' data.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready
    .then((registration) => setInterval(() => void registration.update(), 60 * 60 * 1000))
    .catch(() => {})
}
