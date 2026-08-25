/**
 * Where a jot landed: the shared "inserted here" list, rendered identically by
 * the picker dialog and the Capture management page so the two views cannot
 * drift. Deliberately its own file: Capture must not drag in the picker's
 * ModalDialog / session / live-query imports for three lines of list.
 */
import { findNode } from '../../lib/content/loader'
import type { Entry } from '../../lib/types'

/** First ~90 chars of what the answer looks like now, one line. */
export function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat
}

export function NotePlacementList({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return null
  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
      {entries.map((e) => (
        <li key={e.id} className="text-xs">
          <span className="font-medium text-gray-600">
            {findNode(e.node_id)?.node.label ?? e.node_id}
          </span>
          {e.text && <span className="text-gray-400"> — {snippet(e.text)}</span>}
        </li>
      ))}
    </ul>
  )
}
