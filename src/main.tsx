import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { requestPersistentStorage } from './lib/storage/persist'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Ask the browser not to treat this origin's storage as disposable, before the
// user has typed anything worth losing. Everything the app holds — answers in
// IndexedDB and the session token in localStorage — lives in one evictable
// bucket by default, and evicting it logs the person out and empties the
// worksheet in the same step. Fire-and-forget: a refusal changes nothing about
// how the app behaves, and the engine asks again after sign-in, when a browser
// that grants on engagement is more likely to say yes.
void requestPersistentStorage()

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
