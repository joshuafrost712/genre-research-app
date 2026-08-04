import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useDepthMode } from '../components/DepthModeContext'
import { BlockRenderer } from '../components/blocks/BlockRenderer'
import { AutosaveText } from '../components/blocks/AutosaveText'
import { findNode, nextNavId, routeForSub } from '../lib/content/loader'
import { resolveGenreTokens, useNameTokens } from '../components/GenreNameProvider'
import { setLastNode } from '../lib/storage/appState'
import { upsertEntry, useAllEntries, useEntry } from '../lib/storage/entries'
import { DEFER_TO_DRAFTING, requiredFeatureRefs, STYLE_IDEA_NODE } from '../lib/content/summarize'
import type { ActiveContext } from '../lib/storage/appState'

/**
 * 2d: The Style — compare & decide. The genre's Required features (marked in
 * the 1e style study) appear automatically on one side; on the other, the team
 * records how to achieve each one with this passage. Adding or changing the
 * features themselves happens on the shared 1e pages (they belong to the
 * genre, not to this passage).
 */
export function StyleCompare() {
  const { ctx } = useActiveContext()
  const { mode } = useDepthMode()
  const tokens = useNameTokens()
  const entries = useAllEntries(ctx)
  const genre = useLiveQuery(
    async () => (ctx ? await db.genres.get(ctx.genreId) : undefined),
    [ctx?.genreId],
  )
  const focusText = useLiveQuery(
    async () => (ctx ? await db.focusTexts.get(ctx.focusTextId) : undefined),
    [ctx?.focusTextId],
  )

  useEffect(() => {
    if (ctx) void setLastNode(ctx.projectId, 's0.stylistic_notes')
  }, [ctx])

  if (!ctx || entries === undefined) return <p className="text-sm text-gray-400">Loading…</p>

  const required = requiredFeatureRefs(entries, ctx.genreId)
  const passage = focusText?.reference?.trim() || 'your passage'
  const genreName =
    genre && !genre.name.startsWith('Untitled') ? genre.name : 'the genre'
  const legacyGroup = findNode('s0.stylistic_notes')?.node
  // The optional legacy notes tables predate the Required-features flow and are
  // retired (feedback 2026-07-24 #4) — but never silently: a worksheet that
  // already holds answers in them keeps the section so nothing is orphaned.
  const legacyHasData = entries.some(
    (e) =>
      e.node_id.startsWith('s0.sn.') &&
      e.worksheet_id === ctx.worksheetId &&
      (e.text ?? '').trim() !== '',
  )
  const nextId = nextNavId('s0.stylistic_notes')
  const title = resolveGenreTokens(
    legacyGroup?.label ?? '2d: The Style — Compare & Decide',
    tokens,
  )
  const backLabel = resolveGenreTokens(
    findNode('s0.macro_notes')?.node.label ?? '2c: The Big Picture — Compare & Decide',
    tokens,
  )
  const nextLabel = nextId ? resolveGenreTokens(findNode(nextId)?.node.label ?? '', tokens) : ''

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold" data-dfb-node="s0.stylistic_notes" data-dfb-field="label">
          {title}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {genreName}'s <span className="font-medium">Required</span> style features, and your
          plan for achieving each one with{' '}
          <span className="font-medium text-sky-700">{passage}</span>.
        </p>
        <p className="mt-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900">
          Have the passage in front of you — or better, internalized, especially in oral
          contexts — so you can think about the whole, not line by line.
        </p>
      </div>

      {required.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <p>
            No features of {genreName} are marked <span className="font-medium">Required</span>{' '}
            yet. That marking happens in the style study (1e): pull out each page's special
            features and mark them Required or Common.
          </p>
          <Link
            to="/worksheet/s3a"
            className="mt-3 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Open the style pages (1e) →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {required.map((f) => (
            <FeatureCard key={`${f.tableId}:${f.rowId}`} ctx={ctx} feature={f} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        The Required list belongs to {genreName} itself. To add or change features, open the{' '}
        <Link to="/worksheet/s3a" className="text-sky-700 hover:underline">
          style pages (1e)
        </Link>{' '}
        — changes there affect every passage that uses this genre.
      </p>

      {legacyGroup && legacyHasData && (
        <details className="rounded-xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700">
            More stylistic notes (optional)
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {(legacyGroup.children ?? []).map((child) => (
              <BlockRenderer key={child.id} ctx={ctx} node={child} mode={mode} />
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <Link to="/macro" className="text-sm text-gray-500 hover:underline">
          ← {backLabel}
        </Link>
        {nextId && (
          <Link
            to={routeForSub(nextId)}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Next: {nextLabel} →
          </Link>
        )}
      </div>
    </div>
  )
}

function FeatureCard({
  ctx,
  feature,
}: {
  ctx: ActiveContext
  feature: { tableId: string; rowId: string; areaLabel: string; text: string }
}) {
  const cellKey = `${feature.tableId}__${feature.rowId}`
  const idea = useEntry(ctx, STYLE_IDEA_NODE, 'synthesis', cellKey)
  // Some style decisions genuinely can't precede drafting; the flag rides the
  // same entry's value field and groups the feature at the bottom of the 2e
  // decisions log as "To be decided while drafting" (feedback 2026-07-24 #6).
  // The plan box stays usable for partial notes either way.
  const deferred = idea?.value === DEFER_TO_DRAFTING
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:order-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
              Required · {feature.areaLabel}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{feature.text}</p>
        </div>
        <div className="md:order-1">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            How will you achieve this with the passage?
          </div>
          <AutosaveText
            value={idea?.text ?? ''}
            multiline
            placeholder="Your ideas — words, lines, moments in the passage where this feature can live"
            onSave={(v) =>
              upsertEntry(ctx, STYLE_IDEA_NODE, 'synthesis', { text: v }, cellKey)
            }
          />
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={deferred}
              onChange={() =>
                void upsertEntry(
                  ctx,
                  STYLE_IDEA_NODE,
                  'synthesis',
                  { value: deferred ? '' : DEFER_TO_DRAFTING },
                  cellKey,
                )
              }
              className="h-3.5 w-3.5 accent-emerald-700"
            />
            Best decided while drafting
          </label>
        </div>
      </div>
    </section>
  )
}
