import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
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
  // True only after a resolve actually returned null (no project exists yet) —
  // distinct from the initial "not yet resolved" null, so the retry effect
  // below cannot fire a spurious reload on every ordinary mount.
  const [settledEmpty, setSettledEmpty] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    // tick > 0 means something asked for a re-resolve: a passage/genre switch,
    // an adopted project, or the empty-state retry. Each of those has just
    // changed what `meta` says, so the answer must come from a run that reads it
    // AFTER the change, not from one already in flight. On the first mount
    // (tick 0) sharing is still what we want.
    ensureActiveContext(tick > 0).then((c) => {
      if (cancelled) return
      setCtx(c)
      setSettledEmpty(c === null)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  // Sync can move the active project underneath us: signing in on a fresh device
  // pulls down real work and adopts it in place of the project this browser
  // holds. Without re-resolving here, the person keeps staring at the old
  // project while their answers sit in Dexie one project over.
  useEffect(() => onActiveProjectAdopted(reload), [reload])

  // Behind the onboarding gate, ensureActiveContext resolves null. When the
  // first project row lands (gate submit, team join's pull, or a signed-in
  // pull of cloud work), re-resolve so the app becomes usable without a manual
  // page reload. State-based on purpose, not edge-based on the 0→n count
  // transition: an edge can be consumed while a stale null-resolving run is
  // still in flight, which would leave every page on "Loading…" forever.
  // Cannot spin: once the retry resolves a context, settledEmpty goes false
  // and the deps stop changing.
  const projectCount = useLiveQuery(() => db.projects.count())
  useEffect(() => {
    if (settledEmpty && (projectCount ?? 0) > 0) reload()
  }, [settledEmpty, projectCount, reload])

  return <Ctx.Provider value={{ ctx, reload }}>{children}</Ctx.Provider>
}

export function useActiveContext(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error('useActiveContext must be used within an ActiveContextProvider')
  return v
}
