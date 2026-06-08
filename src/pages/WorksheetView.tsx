import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { findNode, nextNavId } from '../lib/content/loader'
import { ensureActiveProject, setLastNode } from '../lib/storage/appState'
import { visibleAtDepth, type GuideNode } from '../schema/types'
import { useDepthMode } from '../components/DepthModeContext'

/**
 * Renders one subsection. For this scaffold the block renderer is a placeholder
 * that lists each visible block with its type and guidance; the real input
 * components (text, select, tables, grids) are build-order step 2. What is wired
 * here is navigation, depth filtering, the resume cursor, and the recommended
 * next step.
 */
export function WorksheetView() {
  const { nodeId } = useParams()
  const { mode } = useDepthMode()
  const ref = nodeId ? findNode(nodeId) : undefined

  // Persist the resume cursor whenever a subsection is opened.
  useEffect(() => {
    if (!nodeId) return
    let cancelled = false
    ensureActiveProject().then((p) => {
      if (!cancelled) setLastNode(p.id, nodeId)
    })
    return () => {
      cancelled = true
    }
  }, [nodeId])

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        {sectionLabel && (
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {sectionLabel}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-semibold">{node.label}</h1>
        {node.guidance && (
          <p className="mt-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900">
            {node.guidance}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {children.length === 0 ? (
          <p className="text-sm text-gray-500">
            No prompts visible at the {mode} depth. Increase depth to see more.
          </p>
        ) : (
          children.map((block) => <BlockPlaceholder key={block.id} block={block} />)
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

/** Placeholder for a single block. Replaced by real inputs in build step 2. */
function BlockPlaceholder({ block }: { block: GuideNode }) {
  const [open, setOpen] = useState(true)
  if (block.type === 'prose') {
    return <p className="text-sm text-gray-600">{block.label}</p>
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-medium text-gray-800">{block.label}</span>
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
          {block.type}
        </span>
      </button>
      {open && (
        <div className="mt-2">
          {block.guidance && (
            <p className="mb-2 text-xs text-gray-500">{block.guidance}</p>
          )}
          {block.children?.length ? (
            <div className="flex flex-col gap-2 border-l-2 border-gray-100 pl-3">
              {block.children.map((c) => (
                <BlockPlaceholder key={c.id} block={c} />
              ))}
            </div>
          ) : (
            <p className="text-xs italic text-gray-400">
              Input component coming in step 2.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
