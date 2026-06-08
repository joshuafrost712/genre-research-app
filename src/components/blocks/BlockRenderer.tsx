import { effectiveLayer } from '../../lib/content/loader'
import { cellKey } from '../../lib/storage/db'
import type { ActiveContext } from '../../lib/storage/appState'
import {
  addRow,
  removeRow,
  upsertEntry,
  useEntry,
  useRowIds,
} from '../../lib/storage/entries'
import {
  depthVisible,
  visibleAtDepth,
  type DepthMode,
  type GuideNode,
  type Layer,
} from '../../schema/types'
import { AutosaveText } from './AutosaveText'
import { CellInput } from './CellInput'

const SCALE_FALLBACK = [
  { id: 'weak', label: 'Weak' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'strong', label: 'Strong' },
]

/** Dispatches a worksheet node to the right input, recursing through groups. */
export function BlockRenderer({
  ctx,
  node,
  mode,
}: {
  ctx: ActiveContext
  node: GuideNode
  mode: DepthMode
}) {
  if (node.type === 'prose') {
    return <p className="text-sm text-gray-600">{node.label}</p>
  }

  if (node.type === 'group') {
    const children = (node.children ?? []).filter((c) => visibleAtDepth(c, mode))
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-gray-700">{node.label}</legend>
        {node.guidance && <p className="text-xs text-gray-500">{node.guidance}</p>}
        {children.map((child) => (
          <BlockRenderer key={child.id} ctx={ctx} node={child} mode={mode} />
        ))}
      </fieldset>
    )
  }

  const layer = effectiveLayer(node.id)
  if (!layer) {
    return (
      <p className="text-xs italic text-amber-700">
        “{node.label}” has no layer and cannot be saved. Tag it genre / focusText /
        synthesis in the worksheet config.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel node={node} />
      <FieldInput ctx={ctx} node={node} layer={layer} mode={mode} />
    </div>
  )
}

function FieldLabel({ node }: { node: GuideNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-800">{node.label}</label>
      {node.guidance && <p className="mt-0.5 text-xs text-gray-500">{node.guidance}</p>}
    </div>
  )
}

function FieldInput({
  ctx,
  node,
  layer,
  mode,
}: {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
  mode: DepthMode
}) {
  switch (node.type) {
    case 'short_text':
    case 'long_text':
      return <ScalarText ctx={ctx} node={node} layer={layer} />
    case 'single_select':
      return <SingleSelect ctx={ctx} node={node} layer={layer} />
    case 'multi_select':
      return <MultiSelect ctx={ctx} node={node} layer={layer} />
    case 'three_point_scale':
      return <Scale ctx={ctx} node={node} layer={layer} />
    case 'repeatable_list':
      return <RepeatableList ctx={ctx} node={node} layer={layer} />
    case 'repeatable_row_table':
      return <RepeatableTable ctx={ctx} node={node} layer={layer} mode={mode} />
    case 'fixed_grid':
      return <FixedGrid ctx={ctx} node={node} layer={layer} mode={mode} />
    default:
      return null
  }
}

function ScalarText({ ctx, node, layer }: BlockProps) {
  const entry = useEntry(ctx, node.id, layer)
  return (
    <AutosaveText
      value={entry?.text ?? ''}
      multiline={node.type === 'long_text'}
      onSave={(v) => upsertEntry(ctx, node.id, layer, { text: v })}
    />
  )
}

function SingleSelect({ ctx, node, layer }: BlockProps) {
  const entry = useEntry(ctx, node.id, layer)
  return (
    <div className="flex flex-wrap gap-1.5">
      {(node.options ?? []).map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => upsertEntry(ctx, node.id, layer, { value: o.id })}
          className={`rounded-full border px-3 py-1 text-sm ${
            entry?.value === o.id
              ? 'border-gray-800 bg-gray-800 text-white'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function MultiSelect({ ctx, node, layer }: BlockProps) {
  const entry = useEntry(ctx, node.id, layer)
  const selected = parseArray(entry?.value)
  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id]
    upsertEntry(ctx, node.id, layer, { value: JSON.stringify(next) })
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {(node.options ?? []).map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => toggle(o.id)}
          className={`rounded-full border px-3 py-1 text-sm ${
            selected.includes(o.id)
              ? 'border-gray-800 bg-gray-800 text-white'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Scale({ ctx, node, layer }: BlockProps) {
  const entry = useEntry(ctx, node.id, layer)
  const options = node.options?.length ? node.options : SCALE_FALLBACK
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => upsertEntry(ctx, node.id, layer, { value: o.id })}
          className={`flex-1 rounded-md border px-3 py-2 text-sm ${
            entry?.value === o.id
              ? 'border-gray-800 bg-gray-800 text-white'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function RepeatableList({ ctx, node, layer }: BlockProps) {
  const rowIds = useRowIds(ctx, node.id, layer) ?? []
  return (
    <div className="flex flex-col gap-2">
      {rowIds.map((rowId) => (
        <div key={rowId} className="flex items-start gap-2">
          <div className="flex-1">
            <CellInput
              ctx={ctx}
              nodeId={node.id}
              layer={layer}
              cellKey={rowId}
              cellType="short_text"
            />
          </div>
          <RemoveButton onClick={() => removeRow(ctx, node.id, layer, rowId)} />
        </div>
      ))}
      <AddButton label="Add item" onClick={() => addRow(ctx, node.id, layer)} />
    </div>
  )
}

function RepeatableTable({ ctx, node, layer, mode }: BlockProps & { mode: DepthMode }) {
  const rowIds = useRowIds(ctx, node.id, layer) ?? []
  const cols = (node.columns ?? []).filter((c) => depthVisible(c.minDepth, mode))
  return (
    <div className="flex flex-col gap-3">
      {rowIds.length === 0 && (
        <p className="text-xs text-gray-400">No rows yet.</p>
      )}
      {rowIds.map((rowId, i) => (
        <div key={rowId} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">Row {i + 1}</span>
            <RemoveButton onClick={() => removeRow(ctx, node.id, layer, rowId)} />
          </div>
          <div className="flex flex-col gap-2">
            {cols.map((col) => (
              <div key={col.id}>
                <label className="text-xs text-gray-500">{col.label}</label>
                <CellInput
                  ctx={ctx}
                  nodeId={node.id}
                  layer={layer}
                  cellKey={cellKey(rowId, col.id)}
                  cellType={col.cellType}
                  options={col.options}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      <AddButton label="Add row" onClick={() => addRow(ctx, node.id, layer)} />
    </div>
  )
}

function FixedGrid({ ctx, node, layer, mode }: BlockProps & { mode: DepthMode }) {
  const rows = node.rows ?? []
  const cols = (node.columns ?? []).filter((c) => depthVisible(c.minDepth, mode))
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-2 text-sm font-medium text-gray-700">{row.label}</div>
          <div className="flex flex-col gap-2">
            {cols.map((col) => (
              <div key={col.id}>
                <label className="text-xs text-gray-500">{col.label}</label>
                <CellInput
                  ctx={ctx}
                  nodeId={node.id}
                  layer={layer}
                  cellKey={cellKey(row.id, col.id)}
                  cellType={col.cellType}
                  options={col.options}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface BlockProps {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50"
    >
      + {label}
    </button>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove"
      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
    >
      ✕
    </button>
  )
}

function parseArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}
