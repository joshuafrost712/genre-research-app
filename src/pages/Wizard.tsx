import { Link, useSearchParams } from 'react-router-dom'
import { wizardSequence } from '../lib/progress'
import { useDepthMode } from '../components/DepthModeContext'
import { useActiveContext } from '../components/ActiveContextProvider'
import { BlockRenderer } from '../components/blocks/BlockRenderer'

/**
 * Guided wizard: one answerable block at a time across the whole worksheet, in
 * order, respecting the current depth mode. The complement to the section/review
 * view (WorksheetView), for facilitators who want to be led through a first pass.
 */
export function Wizard() {
  const { mode } = useDepthMode()
  const { ctx } = useActiveContext()
  const steps = wizardSequence(mode)
  const [params, setParams] = useSearchParams()

  // The step lives in the URL, not in component state. Two reasons, and the
  // first is the one that matters: switching genre from the header remounts the
  // page, and a step held in useState would send someone back to question 1 —
  // exactly the "I lost my place" the switcher exists to prevent. The second is
  // a bonus: a wizard position becomes something you can send to someone.
  //
  // replace, not push. At Standard depth this is ~80 steps, and pushing would
  // mean ~80 presses of Back to leave the wizard. Back goes back to wherever you
  // came from; the Back button below moves inside the wizard.
  if (steps.length === 0) {
    return <p className="text-sm text-gray-500">No prompts visible at the {mode} depth.</p>
  }

  // Clamped, so a hand-edited or stale ?step= (someone shares a link, then the
  // depth mode narrows the sequence) lands on the last real step rather than
  // rendering nothing.
  const raw = Number(params.get('step'))
  const i = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), steps.length - 1) : 0
  const goTo = (n: number) => {
    const next = new URLSearchParams(params)
    next.set('step', String(Math.min(Math.max(n, 0), steps.length - 1)))
    setParams(next, { replace: true })
  }

  const step = steps[i]
  const atStart = i <= 0
  const atEnd = i >= steps.length - 1

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>
            {step.sectionLabel} · {step.subLabel}
          </span>
          <span>
            {i + 1} / {steps.length}
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-gray-800 transition-all"
            style={{ width: `${((i + 1) / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="min-h-[8rem]">
        {ctx ? (
          <BlockRenderer ctx={ctx} node={step.node} mode={mode} />
        ) : (
          <p className="text-sm text-gray-400">Loading…</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <button
          type="button"
          disabled={atStart}
          onClick={() => goTo(i - 1)}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-40"
        >
          ← Back
        </button>
        <Link
          to={`/worksheet/${step.subId}`}
          className="text-sm text-gray-500 hover:underline"
        >
          Open full section
        </Link>
        {atEnd ? (
          <Link
            to="/"
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Done
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => goTo(i + 1)}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Next →
          </button>
        )}
      </div>
    </div>
  )
}
