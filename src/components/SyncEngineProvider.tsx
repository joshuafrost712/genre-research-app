/**
 * Starts the cloud-sync engine for the lifetime of the app. The engine runs on
 * the Supabase session (NOT Google — Drive is a separate backup feature) and
 * no-ops while nobody is signed in, so this is safe to mount unconditionally.
 * This mount is the only thing that starts it; nothing else may stop it while
 * the app lives, or team sync silently freezes with the chip still on "Saved".
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
