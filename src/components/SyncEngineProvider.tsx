/**
 * Starts the cloud-sync engine for the lifetime of the app. The engine itself
 * no-ops unless Google is configured and a user is signed in, so this is safe to
 * mount unconditionally. Sign-in/out (re)start and stop the engine from the
 * account control; this handles the already-signed-in case on reload.
 */
import { useEffect, type ReactNode } from 'react'
import { syncEngine } from '../lib/sync/engine'

export function SyncEngineProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void syncEngine.start()
    return () => syncEngine.stop()
  }, [])
  return <>{children}</>
}
