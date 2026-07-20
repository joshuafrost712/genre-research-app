import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/storage/db'
import { upsertEntryWithHistory, useEntry } from '../../lib/storage/entries'
import type { ActiveContext } from '../../lib/storage/appState'
import type { Layer } from '../../schema/types'

/**
 * Version history for one field: earlier values with a Restore button, behind a
 * small toggle. Restoring writes through the history-recording path, so the
 * restore itself is also undoable — nothing is ever lost.
 */
export function HistoryList({
  ctx,
  nodeId,
  layer,
  cellKey,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  cellKey?: string
}) {
  const [open, setOpen] = useState(false)
  const entry = useEntry(ctx, nodeId, layer, cellKey)
  const rows = useLiveQuery(
    async () =>
      entry
        ? (await db.history.where('entry_id').equals(entry.id).sortBy('changed_at')).reverse()
        : [],
    [entry?.id],
  )

  if (!entry || !rows || rows.length === 0) return null

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-gray-400 hover:text-gray-700 hover:underline"
      >
        {open ? 'Hide history' : `History (${rows.length})`}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1">
          {rows.map((h) => (
            <li
              key={h.seq}
              className="flex items-start justify-between gap-2 rounded border border-gray-200 bg-gray-50 p-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="text-[10px] text-gray-400">{formatWhen(h.changed_at)}</div>
                <div className="whitespace-pre-wrap text-gray-700">
                  {h.prev_text?.trim() || h.prev_value || <em className="text-gray-400">(empty)</em>}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  void upsertEntryWithHistory(
                    ctx,
                    nodeId,
                    layer,
                    { text: h.prev_text ?? '', value: h.prev_value },
                    cellKey,
                    'restore',
                  )
                }
                className="shrink-0 rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-gray-700"
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}
