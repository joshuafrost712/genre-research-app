import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { findNode, nextNavId } from '../lib/content/loader'
import { setLastNode } from '../lib/storage/appState'
import { visibleAtDepth } from '../schema/types'
import { useDepthMode } from '../components/DepthModeContext'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useProgress } from '../components/useProgress'
import { BlockRenderer } from '../components/blocks/BlockRenderer'

/**
 * Renders one subsection: its visible child blocks wired to autosaving Entries,
 * plus navigation concerns (depth filtering, resume cursor, recommended next).
 */
export function WorksheetView() {
  const { nodeId } = useParams()
  const { mode } = useDepthMode()
  const { ctx } = useActiveContext()
  const progress = useProgress()
  const ref = nodeId ? findNode(nodeId) : undefined

  useEffect(() => {
    if (ctx && nodeId) setLastNode(ctx.projectId, nodeId)
  }, [ctx, nodeId])

  if (!ref) {
    return (
      <div>
        <p className="text-gray-600">That section was not found.</p>
        <Link to="/" className="mt-2 inline-block text-sm text-sky-700 underline">
          Back to home
        </Link>
      </div>
    )
  }

  const { node, parents } = ref
  const sectionLabel = parents[0]?.label
  const children = (node.children ?? []).filter((c) => visibleAtDepth(c, mode))
  const nextId = nextNavId(node.id)
  const next = nextId ? findNode(nextId) : undefined
  const subProgress = progress?.bySubsection[node.id]

  return (
    <div className="flex flex-col gap-6">
      <div>
        {sectionLabel && (
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {sectionLabel}
          </p>
        )}
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">{node.label}</h1>
          {subProgress && subProgress.total > 0 && (
            <span className="shrink-0 text-xs text-gray-500">
              {subProgress.done}/{subProgress.total} answered
            </span>
          )}
        </div>
        {node.guidance && (
          <p className="mt-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900">{node.guidance}</p>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {children.length === 0 ? (
          <p className="text-sm text-gray-500">
            No prompts visible at the {mode} depth. Increase depth to see more.
          </p>
        ) : !ctx ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          children.map((block) => (
            <BlockRenderer key={block.id} ctx={ctx} node={block} mode={mode} />
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <Link to="/" className="text-sm text-gray-500 hover:underline">
          Home
        </Link>
        {next ? (
          <Link
            to={`/worksheet/${next.node.id}`}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Next: {next.node.label} →
          </Link>
        ) : (
          <span className="text-sm text-gray-400">End of worksheet</span>
        )}
      </div>
    </div>
  )
}
