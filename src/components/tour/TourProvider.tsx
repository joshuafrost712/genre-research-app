import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isTourSeen, setTourSeen } from '../../lib/storage/appState'
import type { TourStep } from './tours'

/**
 * Guided-tour runtime. A `<Tour>` auto-opens the first time its id is unseen and
 * marks itself seen when finished or skipped, so it never nags again. Any button
 * can re-open a tour through `useTour().replay(id)`; the matching `<Tour>` is the
 * one that responds, so the app tour (mounted in the layout) replays from any page.
 */
interface TourCtxValue {
  replay: (id: string) => void
  replayTarget: string | null
  replayNonce: number
  consumeReplay: () => void
}

const TourContext = createContext<TourCtxValue | null>(null)

export function TourProvider({ children }: { children: ReactNode }) {
  const [replayTarget, setReplayTarget] = useState<string | null>(null)
  const [replayNonce, setReplayNonce] = useState(0)
  const replay = (id: string) => {
    setReplayTarget(id)
    setReplayNonce((n) => n + 1)
  }
  const consumeReplay = () => setReplayTarget(null)
  return (
    <TourContext.Provider value={{ replay, replayTarget, replayNonce, consumeReplay }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour(): { replay: (id: string) => void } {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useTour must be used within a TourProvider')
  return { replay: ctx.replay }
}

export function Tour({ id, steps }: { id: string; steps: TourStep[] }) {
  const ctx = useContext(TourContext)
  const seen = useLiveQuery(() => isTourSeen(id), [id])
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  // Auto-open the first time this tour is unseen.
  useEffect(() => {
    if (seen === false) {
      setStep(0)
      setOpen(true)
    }
  }, [seen])

  // Re-open on an explicit replay request that targets this tour.
  useEffect(() => {
    if (ctx && ctx.replayTarget === id) {
      setStep(0)
      setOpen(true)
      ctx.consumeReplay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.replayNonce])

  if (!ctx || !open || steps.length === 0) return null

  const last = step >= steps.length - 1
  const close = async () => {
    setOpen(false)
    await setTourSeen(id, true)
  }
  const current = steps[step]

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-5 rounded-full ${i <= step ? 'bg-sky-600' : 'bg-gray-200'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={close}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Skip
          </button>
        </div>

        <h2 className="mt-4 text-lg font-semibold text-gray-900">{current.title}</h2>
        <p className="mt-1.5 text-sm text-gray-700">{current.body}</p>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-sm text-gray-500 enabled:hover:text-gray-800 disabled:opacity-0"
          >
            ← Back
          </button>
          {last ? (
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
              className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** A small "Replay tour" link for any page that hosts a tour. */
export function ReplayTourButton({ id, label = 'Replay tour' }: { id: string; label?: string }) {
  const { replay } = useTour()
  return (
    <button
      type="button"
      onClick={() => replay(id)}
      className="text-xs text-sky-700 hover:underline"
    >
      {label}
    </button>
  )
}
