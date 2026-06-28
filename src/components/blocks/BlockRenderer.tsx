import { useState } from 'react'
import { Link } from 'react-router-dom'
import { effectiveLayer, navSubsectionOf } from '../../lib/content/loader'
import { cellKey } from '../../lib/storage/db'
import type { ActiveContext } from '../../lib/storage/appState'
import {
  addRow,
  removeRow,
  setBlockFollowUp,
  setBlockNotApplicable,
  setRowAsked,
  setRowFollowUp,
  setRowPriority,
  upsertEntry,
  useEntry,
  useRowIds,
} from '../../lib/storage/entries'
import { resolveGenreTokens, useGenreName } from '../GenreNameProvider'
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

const SCALAR_TYPES = new Set([
  'short_text',
  'long_text',
  'single_select',
  'multi_select',
  'three_point_scale',
])

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
  const genre = useGenreName()

  if (node.type === 'prose') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-gray-600">{resolveGenreTokens(node.label, genre)}</p>
        <ExampleToggle node={node} genre={genre} />
        <XrefLinks node={node} />
      </div>
    )
  }

  if (node.type === 'group') {
    const children = (node.children ?? []).filter((c) => visibleAtDepth(c, mode))
    return (
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-gray-700">
          {resolveGenreTokens(node.label, genre)}
        </legend>
        {node.guidance && (
          <p className="text-xs text-gray-500">{resolveGenreTokens(node.guidance, genre)}</p>
        )}
        <ExampleToggle node={node} genre={genre} />
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

  if (SCALAR_TYPES.has(node.type)) {
    return <ScalarField ctx={ctx} node={node} layer={layer} />
  }

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel node={node} />
      <CollectionInput ctx={ctx} node={node} layer={layer} mode={mode} />
    </div>
  )
}

function FieldLabel({ node }: { node: GuideNode }) {
  const genre = useGenreName()
  return (
    <div>
      <label className="text-sm font-medium text-gray-800">
        {resolveGenreTokens(node.label, genre)}
      </label>
      {node.guidance && (
        <p className="mt-0.5 text-xs text-gray-500">{resolveGenreTokens(node.guidance, genre)}</p>
      )}
      {node.footnote && (
        <p className="mt-0.5 text-xs italic text-gray-400">
          {resolveGenreTokens(node.footnote, genre)}
        </p>
      )}
      <ExampleToggle node={node} genre={genre} />
      <XrefLinks node={node} />
    </div>
  )
}

/** A collapsed "Show example" disclosure; renders nothing when the node has none. */
function ExampleToggle({ node, genre }: { node: GuideNode; genre: string }) {
  const [open, setOpen] = useState(false)
  if (!node.example) return null
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-sky-700 hover:underline"
      >
        {open ? 'Hide example' : 'Show example'}
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-line rounded-md bg-sky-50 p-2 text-xs text-sky-900">
          {resolveGenreTokens(node.example, genre)}
        </p>
      )}
    </div>
  )
}

/** Renders a node's cross-references as links to the section that holds them. */
function XrefLinks({ node }: { node: GuideNode }) {
  if (!node.xref?.length) return null
  return (
    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
      {node.xref.map((x) => {
        const target = navSubsectionOf(x.to)
        const text = x.label ?? 'See related section'
        if (!target) return <span key={x.to} className="text-gray-400">{text}</span>
        return (
          <Link key={x.to} to={`/worksheet/${target}`} className="text-sky-700 hover:underline">
            {text} →
          </Link>
        )
      })}
    </p>
  )
}

/** A scalar field with not-applicable and follow-up toggles. */
function ScalarField({ ctx, node, layer }: BlockProps) {
  const entry = useEntry(ctx, node.id, layer)
  const na = !!entry?.is_not_applicable
  const followUp = !!entry?.is_concern_flag
  const fromAI = entry?.ai_confidence != null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <FieldLabel node={node} />
          {fromAI && (
            <span
              title="This answer came from AI sorting. Edit it to make it yours."
              className="mt-1 inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
            >
              from AI
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Flag to come back to this / get more info"
            onClick={() => setBlockFollowUp(ctx, node.id, layer, !followUp)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              followUp ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {followUp ? '✦ Follow up' : 'Follow up'}
          </button>
          <button
            type="button"
            onClick={() => setBlockNotApplicable(ctx, node.id, layer, !na)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              na ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            N/A
          </button>
        </div>
      </div>
      {na ? (
        <p className="text-xs italic text-gray-400">Marked not applicable.</p>
      ) : (
        <ScalarInput ctx={ctx} node={node} layer={layer} />
      )}
    </div>
  )
}

function ScalarInput({ ctx, node, layer }: BlockProps) {
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
    default:
      return null
  }
}

function CollectionInput({
  ctx,
  node,
  layer,
  mode,
}: BlockProps & { mode: DepthMode }) {
  switch (node.type) {
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
  // Editing an AI-sourced answer makes it the human's own: drop the AI mark.
  const clearAI = entry?.ai_confidence != null ? { ai_confidence: undefined } : {}
  return (
    <AutosaveText
      value={entry?.text ?? ''}
      multiline={node.type === 'long_text'}
      onSave={(v) => upsertEntry(ctx, node.id, layer, { text: v, ...clearAI })}
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
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
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
          {node.priorityEligible && (
            <PriorityStar ctx={ctx} nodeId={node.id} layer={layer} rowId={rowId} />
          )}
          {node.askTracking && (
            <AskedToggle ctx={ctx} nodeId={node.id} layer={layer} rowId={rowId} />
          )}
          <RowFollowUp ctx={ctx} nodeId={node.id} layer={layer} rowId={rowId} />
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

type Column = NonNullable<GuideNode['columns']>[number]

/**
 * Mobile-first table input (the "A + B blend" from docs/mobile-table-input.md).
 * A row collapses to a tappable summary: its first answer as a headline plus a
 * chip per other field (green = filled, grey = empty). Opening a row turns it
 * into a one-field-at-a-time mini-form with Back / Skip / Next, so a translator
 * on a phone fills one idea at a time instead of scrolling a tall stack, and can
 * see at a glance what is still empty. Replaces the old scroll-down layout for
 * every repeatable table and fixed grid.
 */
function RepeatableTable({ ctx, node, layer, mode }: BlockProps & { mode: DepthMode }) {
  const rowIds = useRowIds(ctx, node.id, layer) ?? []
  const cols = (node.columns ?? []).filter((c) => depthVisible(c.minDepth, mode))
  const [open, setOpen] = useState<{ rowId: string; idx: number } | null>(null)

  const addAndOpen = async () => {
    const rowId = await addRow(ctx, node.id, layer)
    setOpen({ rowId, idx: 0 })
  }

  return (
    <div className="flex flex-col gap-2">
      {rowIds.length === 0 && <p className="text-xs text-gray-400">No rows yet.</p>}
      {rowIds.map((rowId, i) =>
        open?.rowId === rowId ? (
          <RowEditor
            key={rowId}
            ctx={ctx}
            node={node}
            layer={layer}
            rowId={rowId}
            cols={cols}
            startIdx={open.idx}
            onClose={() => setOpen(null)}
          />
        ) : (
          <RowSummary
            key={rowId}
            ctx={ctx}
            node={node}
            layer={layer}
            rowId={rowId}
            index={i}
            cols={cols}
            onOpen={(idx) => setOpen({ rowId, idx })}
          />
        ),
      )}
      {node.priorityEligible && node.priorityMax != null && (
        <p className="text-[11px] text-gray-400">Mark your top {node.priorityMax} with the star.</p>
      )}
      <AddButton label="Add row" onClick={addAndOpen} />
    </div>
  )
}

function FixedGrid({ ctx, node, layer, mode }: BlockProps & { mode: DepthMode }) {
  const rows = node.rows ?? []
  const cols = (node.columns ?? []).filter((c) => depthVisible(c.minDepth, mode))
  const [open, setOpen] = useState<{ rowId: string; idx: number } | null>(null)
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) =>
        open?.rowId === row.id ? (
          <RowEditor
            key={row.id}
            ctx={ctx}
            node={node}
            layer={layer}
            rowId={row.id}
            cols={cols}
            startIdx={open.idx}
            title={row.label}
            onClose={() => setOpen(null)}
          />
        ) : (
          <RowSummary
            key={row.id}
            ctx={ctx}
            node={node}
            layer={layer}
            rowId={row.id}
            cols={cols}
            fixedTitle={row.label}
            onOpen={(idx) => setOpen({ rowId: row.id, idx })}
          />
        ),
      )}
    </div>
  )
}

/** Collapsed row: a headline plus a filled/empty chip per field. */
function RowSummary({
  ctx,
  node,
  layer,
  rowId,
  index,
  cols,
  fixedTitle,
  onOpen,
}: {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
  rowId: string
  index?: number
  cols: Column[]
  fixedTitle?: string
  onOpen: (idx: number) => void
}) {
  // A fixed grid uses the row's own label as the headline and shows every column
  // as a chip. A repeatable table uses its first answer as the headline.
  const chipCols = fixedTitle ? cols : cols.slice(1)
  const chipOffset = fixedTitle ? 0 : 1
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {node.priorityEligible && (
            <PriorityStar ctx={ctx} nodeId={node.id} layer={layer} rowId={rowId} />
          )}
          {!fixedTitle && <RowFollowUp ctx={ctx} nodeId={node.id} layer={layer} rowId={rowId} />}
        </div>
        {!fixedTitle && <RemoveButton onClick={() => removeRow(ctx, node.id, layer, rowId)} />}
      </div>
      <button type="button" onClick={() => onOpen(0)} className="mt-1 block w-full text-left">
        {fixedTitle ? (
          <div className="text-sm font-medium text-gray-800">{fixedTitle}</div>
        ) : (
          <CellTitle ctx={ctx} node={node} layer={layer} rowId={rowId} col={cols[0]} index={index ?? 0} />
        )}
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chipCols.map((col, ri) => (
          <ChipButton
            key={col.id}
            ctx={ctx}
            node={node}
            layer={layer}
            rowId={rowId}
            col={col}
            onClick={() => onOpen(ri + chipOffset)}
          />
        ))}
      </div>
    </div>
  )
}

function CellTitle({
  ctx,
  node,
  layer,
  rowId,
  col,
  index,
}: {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
  rowId: string
  col: Column
  index: number
}) {
  const entry = useEntry(ctx, node.id, layer, cellKey(rowId, col.id))
  const summary = cellSummary(entry, col)
  return (
    <div>
      <div className="text-[11px] text-gray-400">{chipLabel(col.label)}</div>
      {summary ? (
        <div className="text-sm font-medium text-gray-900">{summary}</div>
      ) : (
        <div className="text-sm text-gray-400">Item {index + 1} — tap to fill</div>
      )}
    </div>
  )
}

function ChipButton({
  ctx,
  node,
  layer,
  rowId,
  col,
  onClick,
}: {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
  rowId: string
  col: Column
  onClick: () => void
}) {
  const entry = useEntry(ctx, node.id, layer, cellKey(rowId, col.id))
  const filled = !!cellSummary(entry, col)
  return (
    <button
      type="button"
      onClick={onClick}
      title={col.label}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
        filled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {filled ? '● ' : '○ '}
      {chipLabel(col.label)}
    </button>
  )
}

/**
 * Open row: every field title is listed (so you always see all the options), but
 * only one field's input is open at a time. Tapping a title expands its box and
 * closes any other. A filled field shows its answer as a preview when closed.
 */
function RowEditor({
  ctx,
  node,
  layer,
  rowId,
  cols,
  startIdx,
  title,
  onClose,
}: {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
  rowId: string
  cols: Column[]
  startIdx: number
  title?: string
  onClose: () => void
}) {
  const [openIdx, setOpenIdx] = useState(Math.max(0, Math.min(startIdx, cols.length - 1)))
  const firstEntry = useEntry(ctx, node.id, layer, cols[0] ? cellKey(rowId, cols[0].id) : undefined)
  const header = title || (cols[0] ? cellSummary(firstEntry, cols[0]) : '') || 'New item'
  return (
    <div className="rounded-lg border-2 border-gray-800 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-gray-800">{header}</span>
        <button type="button" onClick={onClose} className="shrink-0 text-xs text-gray-500 hover:underline">
          Done
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {cols.map((col, i) => (
          <FieldRow
            key={col.id}
            ctx={ctx}
            node={node}
            layer={layer}
            rowId={rowId}
            col={col}
            open={openIdx === i}
            onToggle={() => setOpenIdx((v) => (v === i ? -1 : i))}
          />
        ))}
      </div>
    </div>
  )
}

/** One field inside an open row: a tappable title (with filled marker + preview)
 * that expands its input inline. */
function FieldRow({
  ctx,
  node,
  layer,
  rowId,
  col,
  open,
  onToggle,
}: {
  ctx: ActiveContext
  node: GuideNode
  layer: Layer
  rowId: string
  col: Column
  open: boolean
  onToggle: () => void
}) {
  const entry = useEntry(ctx, node.id, layer, cellKey(rowId, col.id))
  const summary = cellSummary(entry, col)
  const filled = !!summary
  return (
    <div className={`rounded-md border ${open ? 'border-gray-400' : 'border-gray-200'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-2 px-2.5 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className={filled ? 'text-emerald-600' : 'text-gray-300'}>{filled ? '●' : '○'}</span>
            <span className="text-sm text-gray-800">{col.label}</span>
          </span>
          {!open && filled && (
            <span className="mt-0.5 block truncate pl-5 text-xs text-gray-500">{summary}</span>
          )}
        </span>
        <span className="shrink-0 text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5">
          <CellInput
            ctx={ctx}
            nodeId={node.id}
            layer={layer}
            cellKey={cellKey(rowId, col.id)}
            cellType={col.cellType}
            options={col.options}
          />
        </div>
      )}
    </div>
  )
}

/** A short, chip-sized label: the part before the first "(" or "?", capped. */
function chipLabel(label: string): string {
  const head = label.split(/[(?]/)[0].trim()
  return head.length > 22 ? `${head.slice(0, 21)}…` : head || label
}

/** A cell's display text for the summary/chip, or '' when empty. */
function cellSummary(entry: ReturnType<typeof useEntry>, col: Column): string {
  if (!entry) return ''
  if (col.cellType === 'single_select') {
    return (col.options ?? []).find((o) => o.id === entry.value)?.label ?? ''
  }
  if (col.cellType === 'multi_select') {
    const ids = parseArray(entry.value)
    return (col.options ?? [])
      .filter((o) => ids.includes(o.id))
      .map((o) => o.label)
      .join(', ')
  }
  return (entry.text ?? '').trim()
}

function PriorityStar({
  ctx,
  nodeId,
  layer,
  rowId,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  rowId: string
}) {
  const entry = useEntry(ctx, nodeId, layer, rowId)
  const on = !!entry?.is_priority
  return (
    <button
      type="button"
      aria-label={on ? 'Unmark priority' : 'Mark priority'}
      onClick={() => setRowPriority(ctx, nodeId, layer, rowId, !on)}
      className={`text-lg leading-none ${on ? 'text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

function AskedToggle({
  ctx,
  nodeId,
  layer,
  rowId,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  rowId: string
}) {
  const entry = useEntry(ctx, nodeId, layer, rowId)
  const on = !!entry?.is_asked
  return (
    <button
      type="button"
      aria-label={on ? 'Mark as not yet asked' : 'Mark as asked'}
      title={on ? 'Asked' : 'Not yet asked'}
      onClick={() => setRowAsked(ctx, nodeId, layer, rowId, !on)}
      className={`mt-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
        on ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {on ? '✓ Asked' : 'Asked?'}
    </button>
  )
}

function RowFollowUp({
  ctx,
  nodeId,
  layer,
  rowId,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  rowId: string
}) {
  const entry = useEntry(ctx, nodeId, layer, rowId)
  const on = !!entry?.is_concern_flag
  return (
    <button
      type="button"
      aria-label={on ? 'Remove follow-up flag' : 'Flag to follow up'}
      title={on ? 'Flagged to follow up' : 'Flag to follow up'}
      onClick={() => setRowFollowUp(ctx, nodeId, layer, rowId, !on)}
      className={`text-sm leading-none ${on ? 'text-violet-600' : 'text-gray-300 hover:text-violet-400'}`}
    >
      ⚑
    </button>
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
