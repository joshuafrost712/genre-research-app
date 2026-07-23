import { useState } from 'react'
import { Link } from 'react-router-dom'
import { findNode } from '../lib/content/loader'
import { answerableLeaves } from '../lib/progress'
import { deriveSectionRecall } from '../lib/content/sectionRecall'
import { upsertEntryWithHistory, useAllEntries, useEntry } from '../lib/storage/entries'
import { resolveGenreTokens, useGenreName } from './GenreNameProvider'
import { AutosaveText } from './blocks/AutosaveText'
import { HistoryList } from './blocks/HistoryList'
import type { ActiveContext } from '../lib/storage/appState'
import type { GuideNode } from '../schema/types'

/**
 * The genre side of a Create / Translate compare page (2c/2d): the active
 * genre's research for one Workspace 1 subsection, shown automatically. Editing
 * on the spot is possible but requires a click-through, because it changes
 * shared genre data used by every passage; edits auto-save and keep history so
 * lost information can be recovered.
 */
export function GenreRecallPanel({
  ctx,
  sourceSubId,
  genreName,
  detailed = false,
  tablesLabel,
}: {
  ctx: ActiveContext
  sourceSubId: string
  genreName: string
  /** Show each table row's other columns in parentheses (2c emotions conveyance). */
  detailed?: boolean
  /** Names what this section's tables/charts are for, e.g. "for showing specific emotions". */
  tablesLabel?: string
}) {
  const entries = useAllEntries(ctx)
  const [mode, setMode] = useState<'view' | 'confirm' | 'edit'>('view')
  const genre = useGenreName()
  const ref = findNode(sourceSubId)
  if (!ref || entries === undefined) return null

  const fields = deriveSectionRecall(entries, sourceSubId, ctx.genreId, detailed)
  const subLabel = resolveGenreTokens(ref.node.label, genre)

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
          {genreName} · {subLabel}
        </div>
        {mode === 'view' && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMode('confirm')}
              className="text-xs text-emerald-800 hover:underline"
            >
              Edit genre info
            </button>
            <Link
              to={`/worksheet/${sourceSubId}`}
              className="text-xs text-sky-700 hover:underline"
            >
              full page →
            </Link>
          </div>
        )}
        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setMode('view')}
            className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-800"
          >
            Done editing
          </button>
        )}
      </div>

      {mode === 'confirm' && (
        <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          <p>
            You are about to edit shared information about <strong>{genreName}</strong>. Every
            passage that uses this genre sees the change. Edits save automatically and keep a
            history, so earlier versions can be restored.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className="rounded bg-amber-700 px-2.5 py-1 font-medium text-white hover:bg-amber-800"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className="rounded border border-amber-400 px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'edit' ? (
        <EditFields ctx={ctx} sub={ref.node} tablesLabel={tablesLabel} />
      ) : fields.length === 0 ? (
        <p className="text-xs text-gray-500">
          Nothing recorded there yet.{' '}
          <Link to={`/worksheet/${sourceSubId}`} className="text-sky-700 hover:underline">
            Add it first →
          </Link>
        </p>
      ) : (
        <dl className="flex flex-col gap-1.5 text-sm">
          {fields.map((f, i) => (
            <div key={i}>
              <dt className="text-[11px] font-medium text-gray-400">{f.label}</dt>
              <dd className="whitespace-pre-wrap text-gray-800">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Inline editors for the subsection's text prompts, with history per field. */
function EditFields({
  ctx,
  sub,
  tablesLabel,
}: {
  ctx: ActiveContext
  sub: GuideNode
  tablesLabel?: string
}) {
  const genre = useGenreName()
  const leaves = answerableLeaves(sub, 'comprehensive')
  const textLeaves = leaves.filter((l) => l.type === 'short_text' || l.type === 'long_text')
  const hasOther = leaves.length > textLeaves.length
  return (
    <div className="flex flex-col gap-3">
      {textLeaves.map((leaf) => (
        <EditField key={leaf.id} ctx={ctx} leaf={leaf} genre={genre} />
      ))}
      {hasOther && (
        <p className="text-[11px] text-gray-500">
          Tables and charts{tablesLabel ? ` ${tablesLabel}` : ''} are edited on the{' '}
          <Link to={`/worksheet/${sub.id}`} className="text-sky-700 hover:underline">
            full page →
          </Link>
        </p>
      )}
    </div>
  )
}

function EditField({
  ctx,
  leaf,
  genre,
}: {
  ctx: ActiveContext
  leaf: GuideNode
  genre: string
}) {
  const entry = useEntry(ctx, leaf.id, 'genre')
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-medium text-gray-500">
        {resolveGenreTokens(leaf.label, genre)}
      </div>
      <AutosaveText
        value={entry?.text ?? ''}
        multiline={leaf.type === 'long_text'}
        onSave={(v) => upsertEntryWithHistory(ctx, leaf.id, 'genre', { text: v })}
      />
      <HistoryList ctx={ctx} nodeId={leaf.id} layer="genre" />
    </div>
  )
}
