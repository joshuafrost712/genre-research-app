import { useLiveQuery } from 'dexie-react-hooks'
import type { ActiveContext } from '../../lib/storage/appState'
import { db } from '../../lib/storage/db'
import { upsertEntry, useEntry } from '../../lib/storage/entries'
import type { CellType, Layer, SelectOption } from '../../schema/types'
import { TranslatableCell } from './TranslatableCell'

/** One cell of a repeatable-row table or fixed grid, addressed by cell_key. */
export function CellInput({
  ctx,
  nodeId,
  layer,
  cellKey,
  cellType,
  options,
  question,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  cellKey: string
  cellType: CellType
  options?: SelectOption[]
  /** Column label, passed to translation as the context for a terse cell answer. */
  question?: string
}) {
  const entry = useEntry(ctx, nodeId, layer, cellKey)

  if (cellType === 'genre_select') {
    return <GenreCell ctx={ctx} nodeId={nodeId} layer={layer} cellKey={cellKey} value={entry?.text ?? ''} />
  }

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

  // Free-text cells are the team's own words, so these are the ones worth
  // translating. Select and genre-picker cells store ids or a genre name that is a
  // proper noun in both languages.
  return (
    <TranslatableCell
      entry={entry}
      nodeId={nodeId}
      multiline={cellType === 'long_text'}
      question={question}
      onSaveSource={(v) => upsertEntry(ctx, nodeId, layer, { text: v }, cellKey)}
    />
  )
}

/** Cell picker sourced from the project's identified genres; stores the name. */
function GenreCell({
  ctx,
  nodeId,
  layer,
  cellKey,
  value,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  cellKey: string
  value: string
}) {
  const genres = useLiveQuery(
    () => db.genres.where('project_id').equals(ctx.projectId).sortBy('created_at'),
    [ctx.projectId],
  )
  const known = (genres ?? []).some((g) => g.name === value)
  return (
    <select
      value={value}
      onChange={(e) => upsertEntry(ctx, nodeId, layer, { text: e.target.value }, cellKey)}
      className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-gray-500 focus:outline-none"
    >
      <option value="">Choose a genre…</option>
      {(genres ?? []).map((g) => (
        <option key={g.id} value={g.name}>
          {g.name}
        </option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
    </select>
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
