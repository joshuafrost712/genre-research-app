import { useState } from 'react'
import { Link } from 'react-router-dom'
import { findNode } from '../lib/content/loader'
import { confirmEntry, discardProposal, useNeedsReview } from '../lib/storage/entries'
import { useActiveContext } from '../components/ActiveContextProvider'
import type { Entry } from '../lib/types'

/**
 * Review queue: AI-proposed placements arrive as needs_review and nothing files
 * silently. The team confirms (optionally editing the wording) or discards each.
 */
export function Review() {
  const { ctx } = useActiveContext()
  const proposals = useNeedsReview(ctx)

  if (!ctx || proposals === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          AI-proposed placements from{' '}
          <Link to="/routing" className="text-sky-700 underline">
            AI routing
          </Link>
          . Confirm or discard each; nothing is recorded until you confirm.
        </p>
      </div>

      {proposals.length === 0 ? (
        <p className="text-sm text-gray-500">No proposals waiting. Route some notes to populate this queue.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {proposals.map((e) => (
            <ProposalRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ProposalRow({ entry }: { entry: Entry }) {
  const ref = findNode(entry.node_id)
  const [text, setText] = useState(entry.text)
  const confidence = entry.ai_confidence != null ? `${Math.round(entry.ai_confidence * 100)}%` : null

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">
          {ref ? `${ref.parents[0]?.label ?? ''} · ${ref.node.label}` : entry.node_id}
        </span>
        {confidence && <span className="text-[11px] text-gray-400">AI confidence {confidence}</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => confirmEntry(entry.id, text)}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => discardProposal(entry)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-red-50 hover:text-red-600"
        >
          Discard
        </button>
        {ref && (
          <Link
            to={`/worksheet/${ref.parents.at(-1)?.id ?? ''}`}
            className="ml-auto self-center text-xs text-sky-700 hover:underline"
          >
            Open section
          </Link>
        )}
      </div>
    </li>
  )
}
