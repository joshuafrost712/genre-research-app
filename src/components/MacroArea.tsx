import { cellKey } from '../lib/storage/db'
import { addRow, removeRow, useRowIds } from '../lib/storage/entries'
import { CellInput } from './blocks/CellInput'
import { GenreRecallPanel } from './GenreRecallPanel'
import { resolveGenreTokens, useGenreName, useNameTokens } from './GenreNameProvider'
import type { ActiveContext } from '../lib/storage/appState'
import { depthVisible, type ColumnDef, type DepthMode, type GuideNode, type Layer } from '../schema/types'

/**
 * One area of the 2c "Big Picture" page, laid out in three set-apart zones
 * (feedback 2026-07-22 #2/#3/#5/#6): what the passage does (left), the team's
 * idea for the translation in a light-yellow field (middle), and the genre's own
 * conventions (right rail). Columns declare which zone they belong to via
 * `zone`; anything untagged is passage info. Purpose-built for this page rather
 * than reusing the generic one-field-at-a-time table renderer, so the yellow
 * translation field can sit visibly between the passage and the genre.
 */
export function MacroArea({
  ctx,
  area,
  mode,
}: {
  ctx: ActiveContext
  area: GuideNode
  mode: DepthMode
}) {
  const tokens = useNameTokens()
  const genreToken = useGenreName()
  const layer: Layer = area.layer ?? 'synthesis'
  const cols = (area.columns ?? []).filter((c) => depthVisible(c.minDepth, mode))
  const psalmCols = cols.filter((c) => (c.zone ?? 'psalm') === 'psalm')
  const translationCols = cols.filter((c) => c.zone === 'translation')
  const sourceSubId = area.xref?.find((x) => x.relation === 'derivedFrom')?.to
  const isEmotions = area.id === 's0.macro_notes.emotions'

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-lg font-semibold text-gray-900" data-dfb-node={area.id} data-dfb-field="label">
          {resolveGenreTokens(area.label, tokens)}
        </h3>
        {area.guidance && (
          <p className="mt-1 text-sm text-gray-600" data-dfb-node={area.id} data-dfb-field="guidance">
            {resolveGenreTokens(area.guidance, tokens)}
          </p>
        )}
        {area.footnote && (
          <p className="mt-1 text-xs text-gray-500" data-dfb-node={area.id} data-dfb-field="footnote">
            {resolveGenreTokens(area.footnote, tokens)}
          </p>
        )}
        {isEmotions && (
          <p className="mt-1 text-xs text-gray-500">
            How {resolveGenreTokens('{genre}', genreToken)} conveys each feeling shows on the right;
            edit it in the 1d.3 genre study via “Edit genre info”.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div>
          <ZoneHeaders passageToken={resolveGenreTokens('{passage}', tokens)} />
          {area.type === 'fixed_grid' ? (
            <FixedRows ctx={ctx} area={area} layer={layer} psalmCols={psalmCols} translationCols={translationCols} />
          ) : (
            <RepeatableRows
              ctx={ctx}
              area={area}
              layer={layer}
              psalmCols={psalmCols}
              translationCols={translationCols}
            />
          )}
        </div>
        {sourceSubId && (
          <div>
            <GenreRecallPanel
              ctx={ctx}
              sourceSubId={sourceSubId}
              genreName={resolveGenreTokens('{genre}', genreToken)}
              detailed={isEmotions}
            />
          </div>
        )}
      </div>
    </section>
  )
}

/** The two-zone column captions above the rows (genre is captioned in its rail). */
function ZoneHeaders({ passageToken }: { passageToken: string }) {
  return (
    <div className="mb-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
        In the passage
        {passageToken && passageToken !== 'your passage' ? ` (${passageToken})` : ''}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-yellow-700">
        Your idea for the translation
      </div>
    </div>
  )
}

function FixedRows({
  ctx,
  area,
  layer,
  psalmCols,
  translationCols,
}: {
  ctx: ActiveContext
  area: GuideNode
  layer: Layer
  psalmCols: ColumnDef[]
  translationCols: ColumnDef[]
}) {
  const rows = area.rows ?? []
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <RowZones
          key={row.id}
          ctx={ctx}
          nodeId={area.id}
          layer={layer}
          rowId={row.id}
          rowLabel={row.label}
          psalmCols={psalmCols}
          translationCols={translationCols}
        />
      ))}
    </div>
  )
}

function RepeatableRows({
  ctx,
  area,
  layer,
  psalmCols,
  translationCols,
}: {
  ctx: ActiveContext
  area: GuideNode
  layer: Layer
  psalmCols: ColumnDef[]
  translationCols: ColumnDef[]
}) {
  const rowIds = useRowIds(ctx, area.id, layer) ?? []
  return (
    <div className="flex flex-col gap-3">
      {rowIds.length === 0 && <p className="text-xs text-gray-400">No rows yet.</p>}
      {rowIds.map((rowId) => (
        <RowZones
          key={rowId}
          ctx={ctx}
          nodeId={area.id}
          layer={layer}
          rowId={rowId}
          psalmCols={psalmCols}
          translationCols={translationCols}
          onRemove={() => void removeRow(ctx, area.id, layer, rowId)}
        />
      ))}
      <button
        type="button"
        onClick={() => void addRow(ctx, area.id, layer)}
        className="self-start rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50"
      >
        + Add row
      </button>
    </div>
  )
}

/** One row split into the passage zone and the light-yellow translation zone. */
function RowZones({
  ctx,
  nodeId,
  layer,
  rowId,
  rowLabel,
  psalmCols,
  translationCols,
  onRemove,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  rowId: string
  rowLabel?: string
  psalmCols: ColumnDef[]
  translationCols: ColumnDef[]
  onRemove?: () => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-2">
      {(rowLabel || onRemove) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {rowLabel && <span className="text-sm font-medium text-gray-800">{rowLabel}</span>}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove row"
              className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          {psalmCols.map((col) => (
            <ZoneCell key={col.id} ctx={ctx} nodeId={nodeId} layer={layer} rowId={rowId} col={col} />
          ))}
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-2">
          {translationCols.map((col) => (
            <ZoneCell key={col.id} ctx={ctx} nodeId={nodeId} layer={layer} rowId={rowId} col={col} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** A single labelled cell inside a zone; reuses the shared autosaving CellInput. */
function ZoneCell({
  ctx,
  nodeId,
  layer,
  rowId,
  col,
}: {
  ctx: ActiveContext
  nodeId: string
  layer: Layer
  rowId: string
  col: ColumnDef
}) {
  const tokens = useNameTokens()
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-medium text-gray-500">
        {resolveGenreTokens(col.label, tokens)}
      </div>
      <CellInput
        ctx={ctx}
        nodeId={nodeId}
        layer={layer}
        cellKey={cellKey(rowId, col.id)}
        cellType={col.cellType}
        options={col.options}
      />
    </div>
  )
}
