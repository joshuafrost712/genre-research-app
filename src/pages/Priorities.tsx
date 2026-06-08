import { Link } from 'react-router-dom'
import { findNode } from '../lib/content/loader'
import { useAllEntries } from '../lib/storage/entries'
import { useActiveContext } from '../components/ActiveContextProvider'
import type { Entry } from '../lib/types'

/**
 * "Your priorities": every priority-starred row across the worksheet, so the team
 * sees at a glance the distinctive features they marked to carry into translation.
 */
export function Priorities() {
  const { ctx } = useActiveContext()
  const entries = useAllEntries(ctx)

  if (!ctx || entries === undefined) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const starred = entries.filter((e) => e.is_priority && e.cell_key)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Your priorities</h1>
      {starred.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nothing starred yet. In the feature tables, tap the star on a row to mark
          your top one or two to carry into the translation.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {starred.map((e) => {
            const node = findNode(e.node_id)?.node
            return (
              <li key={e.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs font-medium text-gray-400">
                  {node?.label ?? e.node_id}
                </div>
                <div className="mt-0.5 text-sm text-gray-800">
                  {rowText(e, entries) || <span className="italic text-gray-400">(empty)</span>}
                </div>
                {node && (
                  <Link
                    to={`/worksheet/${findNode(e.node_id)?.parents.at(-1)?.id ?? ''}`}
                    className="mt-1 inline-block text-xs text-sky-700 hover:underline"
                  >
                    Open
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Display text for a starred row: the list item, or the table row's joined cells. */
function rowText(row: Entry, all: Entry[]): string {
  if (row.text?.trim()) return row.text.trim()
  const prefix = `${row.cell_key}__`
  return all
    .filter((e) => e.cell_key?.startsWith(prefix) && e.text?.trim())
    .map((e) => e.text.trim())
    .join(' · ')
}
