import type { ActiveContext } from '../../lib/storage/appState'
import { upsertEntry, useEntry } from '../../lib/storage/entries'
import type { CellType, Layer, SelectOption } from '../../schema/types'
import { AutosaveText } from './AutosaveText'

/** One cell of a repeatable-row table or fixed grid, addressed by cell_key. */
export function CellInput({
  ctx,
  nodeId,
  layer,
  cellKey,
  cellType,
  options,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  cellKey: string
  cellType: CellType
  options?: SelectOption[]
}) {
  const entry = useEntry(ctx, nodeId, layer, cellKey)

  if (cellType === 'single_select') {
    return (
      <select
        value={entry?.value ?? ''}
        onChange={(e) => upsertEntry(ctx, nodeId, layer, { value: e.target.value }, cellKey)}
        className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-gray-500 focus:outline-none"
      >
        <option value="">—</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  if (cellType === 'multi_select') {
    const selected: string[] = entry?.value ? safeArray(entry.value) : []
    const toggle = (id: string) => {
      const next = selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
      upsertEntry(ctx, nodeId, layer, { value: JSON.stringify(next) }, cellKey)
    }
    return (
      <div className="flex flex-wrap gap-1">
        {(options ?? []).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              selected.includes(o.id)
                ? 'border-gray-800 bg-gray-800 text-white'
                : 'border-gray-300 text-gray-600'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <AutosaveText
      value={entry?.text ?? ''}
      multiline={cellType === 'long_text'}
      onSave={(v) => upsertEntry(ctx, nodeId, layer, { text: v }, cellKey)}
    />
  )
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}
