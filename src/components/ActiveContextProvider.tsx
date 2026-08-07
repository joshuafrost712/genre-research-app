import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { ensureActiveContext, type ActiveContext } from '../lib/storage/appState'
import { onActiveProjectAdopted } from '../lib/sync/adopt'

interface Value {
  ctx: ActiveContext | null
  /** Re-resolve after the active focus text or genre is switched. */
  reload: () => void
}

const Ctx = createContext<Value | null>(null)

/**
 * Resolves the active editing context once and shares it. `reload` re-resolves
 * after the context switcher changes the active focus text or genre, so the
 * worksheet and progress follow the selection without remounting the tree.
 */
export function ActiveContextProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<ActiveContext | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    ensureActiveContext().then((c) => {
      if (!cancelled) setCtx(c)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  // Sync can move the active project underneath us: signing in on a fresh device
  // pulls down real work and adopts it in place of the empty starter this browser
  // just created. Without re-resolving here, the person keeps staring at the
  // starter while their answers sit in Dexie one project over.
  useEffect(() => onActiveProjectAdopted(reload), [reload])

  return <Ctx.Provider value={{ ctx, reload }}>{children}</Ctx.Provider>
}

export function useActiveContext(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error('useActiveContext must be used within an ActiveContextProvider')
  return v
}
