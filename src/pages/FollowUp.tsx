import { Link } from 'react-router-dom'
import { findNode, navSubsectionOf } from '../lib/content/loader'
import { useAllEntries } from '../lib/storage/entries'
import { useActiveContext } from '../components/ActiveContextProvider'
import { Tour, ReplayTourButton } from '../components/tour/TourProvider'
import { FOLLOWUP_TOUR, FOLLOWUP_TOUR_STEPS } from '../components/tour/tours'
import type { Entry } from '../lib/types'

/**
 * "Follow up": every block or row flagged "want more info / come back to this",
 * gathered in one list. Katie's use case: when a researcher finally sits with a
 * local expert, they open this page and have their open questions in front of
 * them instead of hunting through the worksheet.
 */
export function FollowUp() {
  const { ctx } = useActiveContext()
  const entries = useAllEntries(ctx)

  if (!ctx || entries === undefined) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const flagged = entries.filter((e) => e.is_concern_flag)

  return (
    <div className="flex flex-col gap-4">
      <Tour id={FOLLOWUP_TOUR} steps={FOLLOWUP_TOUR_STEPS} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Follow up</h1>
        <ReplayTourButton id={FOLLOWUP_TOUR} />
      </div>
      <p className="text-sm text-gray-600">
        Everything you marked “Follow up”. Use this as your list of things to ask
        about or come back to later.
      </p>
      {flagged.length === 0 ? (
        <p className="text-sm text-gray-500">
          Nothing flagged yet. On any question, tap “Follow up” to add it here so
          you can return to it later.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {flagged.map((e) => {
            const node = findNode(e.node_id)?.node
            const target = navSubsectionOf(e.node_id)
            return (
              <li key={e.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs font-medium text-gray-400">
                  {node?.label ?? e.node_id}
                </div>
                {rowText(e, entries) && (
                  <div className="mt-0.5 text-sm text-gray-800">{rowText(e, entries)}</div>
                )}
                {target && (
                  <Link
                    to={`/worksheet/${target}`}
                    className="mt-1 inline-block text-xs text-sky-700 hover:underline"
                  >
                    Open →
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

/** Display text for a flagged entry: its own text, or a row's joined cells. */
function rowText(row: Entry, all: Entry[]): string {
  if (row.text?.trim()) return row.text.trim()
  if (!row.cell_key) return ''
  const prefix = `${row.cell_key}__`
  return all
    .filter((e) => e.cell_key?.startsWith(prefix) && e.text?.trim())
    .map((e) => e.text.trim())
    .join(' · ')
}
