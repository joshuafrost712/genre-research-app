import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  automatedAvailable,
  buildExportBundle,
  importPlacementsText,
  listPendingNotes,
  pullPlacements,
  pushPendingNotes,
  type IngestResult,
} from '../routing/operations'
import {
  clearRoutingToken,
  getRoutingRepo,
  getRoutingToken,
  isRoutingRepoConfigured,
  setRoutingToken,
} from '../routing/config'
import { useActiveContext } from '../components/ActiveContextProvider'
import { TranslationHandoffPanel } from '../components/TranslationHandoffPanel'
import { Tour, ReplayTourButton } from '../components/tour/TourProvider'
import { SORT_AI_TOUR, SORT_AI_TOUR_STEPS } from '../components/tour/tours'

/**
 * AI routing without a metered API: Claude (Max) routes captured notes into
 * worksheet placements, either by working on a GitHub repo or via a token-free
 * copy/paste path. Imported placements become needs_review entries to confirm.
 */
export function Routing() {
  const { ctx } = useActiveContext()
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [bundle, setBundle] = useState('')
  const [reply, setReply] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (ctx) listPendingNotes(ctx).then((n) => setPendingCount(n.length))
  }, [ctx, msg])

  if (!ctx) return <p className="text-sm text-gray-400">Loading…</p>

  const summarize = (r: IngestResult) =>
    `Imported ${r.stored} placement${r.stored === 1 ? '' : 's'} from ${r.files} note${
      r.files === 1 ? '' : 's'
    } as needs-review${
      r.conflicts ? `, ${r.conflicts} need your decision in Review (AI suggests a different answer)` : ''
    }${r.rejected ? `, ${r.rejected} rejected` : ''}.`

  const makeBundle = async () => {
    const { text, count } = await buildExportBundle(ctx)
    setBundle(text)
    setMsg(count === 0 ? 'No pending notes to route.' : null)
    try {
      await navigator.clipboard.writeText(text)
      if (count > 0) setMsg('Copied to clipboard. Paste it into Claude.')
    } catch {
      /* clipboard may be unavailable; the textarea below holds the text */
    }
  }

  const importReply = async () => {
    try {
      const r = await importPlacementsText(reply, ctx)
      setReply('')
      setMsg(summarize(r))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Tour id={SORT_AI_TOUR} steps={SORT_AI_TOUR_STEPS} />
      <div>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">AI routing</h1>
          <ReplayTourButton id={SORT_AI_TOUR} />
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Let Claude propose where your captured notes belong. Claude proposes; the
          team confirms each placement in{' '}
          <Link to="/review" className="text-sky-700 underline">
            Review
          </Link>
          . No metered API — Claude works through a Max subscription.
        </p>
        {pendingCount !== null && (
          <p className="mt-1 text-sm text-gray-600">
            {pendingCount} note{pendingCount === 1 ? '' : 's'} not yet routed.
          </p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Copy / paste (no setup)</h2>
        <button
          type="button"
          onClick={makeBundle}
          className="self-start rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Prepare notes for Claude
        </button>
        {bundle && (
          <textarea
            readOnly
            value={bundle}
            rows={6}
            className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <label className="mt-2 text-xs text-gray-500">Paste Claude's JSON reply here</label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={4}
          placeholder='{"results": [ ... ]}'
          className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs focus:border-gray-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={importReply}
          disabled={!reply.trim()}
          className="self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40"
        >
          Import placements
        </button>
      </section>

      <AutomatedPanel onResult={(r) => setMsg(summarize(r))} onError={setMsg} />

      {/* Same no-metered-API handoff, for translating answers rather than routing
          notes. Renders nothing when no answers are waiting. */}
      <TranslationHandoffPanel />

      {msg && <p className="rounded-md bg-gray-100 p-3 text-sm text-gray-700">{msg}</p>}
    </div>
  )
}

function AutomatedPanel({
  onResult,
  onError,
}: {
  onResult: (r: IngestResult) => void
  onError: (m: string) => void
}) {
  const { ctx } = useActiveContext()
  const [token, setTokenState] = useState('')
  const [hasToken, setHasToken] = useState(getRoutingToken() !== null)
  const repo = getRoutingRepo()

  if (!isRoutingRepoConfigured()) {
    return (
      <section className="rounded-lg border border-dashed border-gray-300 p-3 text-sm text-gray-400">
        <h2 className="font-semibold text-gray-500">Automated GitHub path (optional)</h2>
        <p className="text-xs">
          Set VITE_ROUTING_REPO (e.g. <code>you/genre-routing</code>) to push notes
          to a private repo and pull Claude's results automatically. Until then, use
          the copy/paste path above.
        </p>
      </section>
    )
  }

  const run = async (fn: () => Promise<IngestResult | { pushed: number }>) => {
    if (!ctx) return
    try {
      const r = await fn()
      if ('pushed' in r) onError(`Pushed ${r.pushed} note(s) to ${repo}. Route them with Claude, then Pull.`)
      else onResult(r)
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3">
      <h2 className="text-sm font-semibold text-gray-700">Automated GitHub path</h2>
      <p className="text-xs text-gray-500">Repo: {repo}</p>
      {hasToken ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => run(() => pushPendingNotes(ctx!))}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Push pending notes
          </button>
          <button
            type="button"
            onClick={() => run(() => pullPlacements(ctx!))}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Pull placements
          </button>
          <button
            type="button"
            onClick={() => {
              clearRoutingToken()
              setHasToken(false)
            }}
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            Forget token
          </button>
          {!automatedAvailable() && (
            <span className="text-xs text-amber-700">Token not detected; re-enter it.</span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setTokenState(e.target.value)}
            placeholder="Fine-grained GitHub token (Contents: read & write)"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (!token.trim()) return
              setRoutingToken(token)
              setTokenState('')
              setHasToken(true)
            }}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Save token
          </button>
        </div>
      )}
    </section>
  )
}
