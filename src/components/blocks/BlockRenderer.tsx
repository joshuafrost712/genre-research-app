import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { effectiveLayer, navSubsectionOf } from '../../lib/content/loader'
import { cellKey, db } from '../../lib/storage/db'
import {
  createGenre,
  deleteGenre,
  mergeGenres,
  renameGenre,
  setActiveGenre,
  type ActiveContext,
} from '../../lib/storage/appState'
import { duplicatePairs, findDuplicate } from '../../lib/genreNames'
import { useActiveContext } from '../ActiveContextProvider'
import type { Genre } from '../../lib/types'
import {
  addRow,
  removeRow,
  setBlockFollowUp,
  setBlockNotApplicable,
  setRowAsked,
  setRowFollowUp,
  setRowPriority,
  upsertEntry,
  useAllEntries,
  useEntry,
  useRowIds,
} from '../../lib/storage/entries'
import { deriveSectionRecall, macroDecisions, translationSummary } from '../../lib/content/sectionRecall'
import {
  needsSummary,
  requiredFeatureRefs,
  STYLE_IDEA_NODE,
  SUMMARY_KEY,
} from '../../lib/content/summarize'
import { resolveGenreTokens, useGenreName } from '../GenreNameProvider'
import { useDepthMode } from '../DepthModeContext'
import { genreProgress } from '../../lib/progress'
import { addCustomOption, mergeOptions, useCustomOptions } from '../../lib/customOptions'
import {
  depthVisible,
  visibleAtDepth,
  type DepthMode,
  type GuideNode,
  type Layer,
} from '../../schema/types'
import { AutosaveText } from './AutosaveText'
import { AudioRecorderBlock } from './AudioRecorder'
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
  'genre_select',
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

  if (node.type === 'translation_summary') {
    return <TranslationSummaryBlock ctx={ctx} />
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
      {node.help && <ColumnHelp text={resolveGenreTokens(node.help, genre)} />}
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
            Not applicable
          </button>
        </div>
      </div>
      {na ? (
        <p className="text-xs italic text-gray-400">Marked not applicable.</p>
      ) : (
        <>
          <ScalarInput ctx={ctx} node={node} layer={layer} />
          {node.type === 'long_text' && layer === 'genre' && (
            <SummaryCompanion ctx={ctx} node={node} layer={layer} mainText={entry?.text ?? ''} />
          )}
        </>
      )}
    </div>
  )
}

/**
 * The one-line summary companion for a long genre answer. The full discussion
 * is great record-keeping; the genre summary table (1f) shows this short line.
 * Non-blocking: a nudge appears when the answer runs long (~15+ words), and the
 * summary box stays once one exists.
 */
function SummaryCompanion({
  ctx,
  node,
  layer,
  mainText,
}: BlockProps & { mainText: string }) {
  const summaryEntry = useEntry(ctx, node.id, layer, SUMMARY_KEY)
  const summary = (summaryEntry?.text ?? '').trim()
  if (!needsSummary(mainText) && !summary) return null
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-gray-600">Table summary (one line)</span>
        {!summary && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            ▲ needs a summary for the table
          </span>
        )}
      </div>
      <AutosaveText
        value={summaryEntry?.text ?? ''}
        placeholder="One short line for the genre summary table"
        onSave={(v) => upsertEntry(ctx, node.id, layer, { text: v }, SUMMARY_KEY)}
      />
      <p className="mt-1 text-[10px] text-gray-400">
        Your full notes above are great record-keeping. This short line is what the summary
        table (1f) shows.
      </p>
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
    case 'genre_select':
      return <GenreSelect ctx={ctx} node={node} layer={layer} />
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
    case 'genre_bank':
      return <GenreBankInline ctx={ctx} />
    case 'audio_recorder':
      return <AudioRecorderBlock ctx={ctx} nodeId={node.id} />
    default:
      return null
  }
}

/**
 * The project's genre list, edited inline in 1A. These are real Genre entities
 * (the single source of truth), so a genre added here appears on the All Psalms
 * & Genres page and in every genre picker (feedback #4). Feedback 2026-07-20
 * #7/#12 added: a "Describe" jump to 1b, deletion (confirmed, with an
 * explanation), unique names, and near-duplicate detection with a merge offer.
 */
type BankSort = 'az' | 'za' | 'described'

const BANK_SORTS: { id: BankSort; label: string }[] = [
  { id: 'az', label: 'A→Z' },
  { id: 'za', label: 'Z→A' },
  { id: 'described', label: 'Most described' },
]

function GenreBankInline({ ctx }: { ctx: ActiveContext }) {
  const navigate = useNavigate()
  const { reload } = useActiveContext()
  const { mode } = useDepthMode()
  const entries = useAllEntries(ctx)
  const genres = useLiveQuery(
    () => db.genres.where('project_id').equals(ctx.projectId).sortBy('created_at'),
    [ctx.projectId],
  )
  // Sort preference persists per project (feedback 2026-07-20 evening #6).
  const sortMeta = useLiveQuery(() => db.meta.get(`bankSort:${ctx.projectId}`), [ctx.projectId])
  const sort = (sortMeta?.value as BankSort) || 'az'
  const setSort = (s: BankSort) => void db.meta.put({ key: `bankSort:${ctx.projectId}`, value: s })
  const dismissed = useLiveQuery(
    () => db.meta.where('key').startsWith('dupDismiss:').toArray(),
    [],
  )
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [nearMatch, setNearMatch] = useState<{ draft: string; match: Genre } | null>(null)
  const [mergePair, setMergePair] = useState<[Genre, Genre] | null>(null)

  const add = () => {
    const name = draft.trim()
    if (!name) return
    const dup = findDuplicate(name, genres ?? [])
    if (dup?.kind === 'exact') {
      setNotice(
        `"${dup.match.name}" is already in your list. Every genre needs its own name, so give this one a different name (or open the existing entry instead).`,
      )
      return
    }
    if (dup?.kind === 'near') {
      setNearMatch({ draft: name, match: dup.match })
      return
    }
    void createGenre(ctx.projectId, name)
    setDraft('')
  }

  const dismissKey = (a: Genre, b: Genre) => `dupDismiss:${[a.id, b.id].sort().join(':')}`
  const openPair = duplicatePairs(genres ?? []).find(
    (pair) => !(dismissed ?? []).some((m) => m.key === dismissKey(pair[0], pair[1])),
  )

  const describedCount = (genreId: string) =>
    genreProgress(entries ?? [], ctx.projectId, genreId, mode).overall.done
  const sorted = [...(genres ?? [])].sort((a, b) => {
    if (sort === 'described') {
      const d = describedCount(b.id) - describedCount(a.id)
      if (d !== 0) return d
    }
    const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    return sort === 'za' ? -cmp : cmp
  })

  return (
    <div className="flex flex-col gap-2">
      {openPair && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-medium">"{openPair[0].name}"</span> and{' '}
          <span className="font-medium">"{openPair[1].name}"</span> look like they could be the
          same genre written two ways.
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMergePair(openPair)}
              className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-800"
            >
              They are the same — merge them
            </button>
            <button
              type="button"
              onClick={() => void db.meta.put({ key: dismissKey(openPair[0], openPair[1]), value: '1' })}
              className="rounded-md border border-amber-300 px-2.5 py-1 text-xs text-amber-800 hover:bg-amber-100"
            >
              They are different — keep both
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="Add a genre"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Add
        </button>
      </div>
      {(genres?.length ?? 0) > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-gray-500">Sort:</span>
          {BANK_SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                sort === s.id
                  ? 'border-gray-800 bg-gray-800 text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {sorted.map((g) => (
        <GenreBankRow
          key={g.id}
          ctx={ctx}
          genre={g}
          others={(genres ?? []).filter((o) => o.id !== g.id)}
          onNotice={setNotice}
          onChanged={reload}
          onDescribe={async () => {
            await setActiveGenre(ctx.projectId, g.id)
            reload()
            navigate('/worksheet/s1b')
          }}
        />
      ))}
      <p className="text-[11px] text-gray-400">
        These genres appear on the All Psalms &amp; Genres page and wherever you choose a genre.
      </p>

      {notice && (
        <BankDialog onClose={() => setNotice(null)}>
          <h2 className="text-base font-semibold text-gray-900">That name is taken</h2>
          <p className="mt-2 text-sm text-gray-700">{notice}</p>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            OK
          </button>
        </BankDialog>
      )}

      {nearMatch && (
        <BankDialog onClose={() => setNearMatch(null)}>
          <h2 className="text-base font-semibold text-gray-900">Is this the same genre?</h2>
          <p className="mt-2 text-sm text-gray-700">
            "{nearMatch.draft}" is spelled very close to "{nearMatch.match.name}", which is
            already in your list. Adding it twice would split your answers between two copies.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={async () => {
                await setActiveGenre(ctx.projectId, nearMatch.match.id)
                setNearMatch(null)
                setDraft('')
              }}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Same genre — use "{nearMatch.match.name}"
            </button>
            <button
              type="button"
              onClick={() => {
                void createGenre(ctx.projectId, nearMatch.draft)
                setNearMatch(null)
                setDraft('')
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Different genre — add both
            </button>
            <button
              type="button"
              onClick={() => setNearMatch(null)}
              className="text-xs text-gray-500 hover:underline"
            >
              Go back and edit the name
            </button>
          </div>
        </BankDialog>
      )}

      {mergePair && (
        <BankDialog onClose={() => setMergePair(null)}>
          <h2 className="text-base font-semibold text-gray-900">Merge these two genres</h2>
          <p className="mt-2 text-sm text-gray-700">
            Pick the name to keep. Answers from the other copy move over wherever the kept genre
            has none of its own; where both copies answered the same question, the kept genre's
            answer wins. This cannot be undone.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {[
              [mergePair[0], mergePair[1]],
              [mergePair[1], mergePair[0]],
            ].map(([keep, fold]) => (
              <button
                key={keep.id}
                type="button"
                onClick={async () => {
                  await mergeGenres(ctx.projectId, fold.id, keep.id)
                  setMergePair(null)
                  reload()
                }}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
              >
                Keep "{keep.name}" (fold "{fold.name}" into it)
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMergePair(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </BankDialog>
      )}
    </div>
  )
}

function GenreBankRow({
  ctx,
  genre,
  others,
  onNotice,
  onChanged,
  onDescribe,
}: {
  ctx: ActiveContext
  genre: Genre
  others: Genre[]
  onNotice: (msg: string) => void
  onChanged: () => void
  onDescribe: () => void
}) {
  const [text, setText] = useState(genre.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Reflect external renames (e.g. edited on the genres hub) into the field.
  useEffect(() => setText(genre.name), [genre.name])
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const name = text.trim()
          if (!name || name === genre.name) return
          if (findDuplicate(name, others)?.kind === 'exact') {
            onNotice(
              `"${name}" is already the name of another genre in your list. Every genre needs its own name, so this one keeps its old name.`,
            )
            setText(genre.name)
            return
          }
          void renameGenre(genre.id, name)
        }}
        className="flex-1 bg-transparent text-sm focus:outline-none"
      />
      <button
        type="button"
        onClick={onDescribe}
        className="shrink-0 rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800"
      >
        Describe this genre →
      </button>
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        aria-label={`Delete ${genre.name}`}
        className="shrink-0 rounded-md px-1.5 py-1 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600"
      >
        ✕
      </button>
      {confirmDelete && (
        <BankDialog onClose={() => setConfirmDelete(false)}>
          <h2 className="text-base font-semibold text-gray-900">Delete "{genre.name}"?</h2>
          <p className="mt-2 text-sm text-gray-700">
            This removes the genre and everything written about it: its answers in Workspace 1,
            and any comparisons or flags that used it in Workspace 2. This cannot be undone. If
            two entries are really the same genre, merging keeps the answers — deleting does not.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={async () => {
                await deleteGenre(ctx.projectId, genre.id)
                setConfirmDelete(false)
                onChanged()
              }}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              Delete it
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Keep it
            </button>
          </div>
        </BankDialog>
      )}
    </div>
  )
}

/** Minimal modal shell for the genre-bank confirmations. */
function BankDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        {children}
      </div>
    </div>
  )
}

/** Pick one of the identified genres. Stores the genre NAME as text so every
 * existing reader (progress, export, summaries) works unchanged (feedback #2/#3). */
function GenreSelect({ ctx, node, layer }: BlockProps) {
  const entry = useEntry(ctx, node.id, layer)
  const genres = useLiveQuery(
    () => db.genres.where('project_id').equals(ctx.projectId).sortBy('created_at'),
    [ctx.projectId],
  )
  const value = entry?.text ?? ''
  const known = (genres ?? []).some((g) => g.name === value)
  return (
    <select
      value={value}
      onChange={(e) => upsertEntry(ctx, node.id, layer, { text: e.target.value })}
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

/**
 * Read-only recall of the work already done in a Section 3 subsection, for the
 * active genre, shown above the matching stylistic-notes table so a team sees
 * their observations here instead of re-entering them (feedback #5/#22). Starred
 * items come first and are marked.
 */
function SectionRecall({ ctx, sourceSubId }: { ctx: ActiveContext; sourceSubId: string }) {
  const entries = useAllEntries(ctx)
  if (entries === undefined) return null
  const fields = deriveSectionRecall(entries, sourceSubId, ctx.genreId)
  if (fields.length === 0) {
    return (
      <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
        Nothing recorded there yet.{' '}
        <Link to={`/worksheet/${sourceSubId}`} className="text-sky-700 hover:underline">
          Add it first →
        </Link>
      </p>
    )
  }
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-gray-600">What you noted</span>
        <Link to={`/worksheet/${sourceSubId}`} className="text-sky-700 hover:underline">
          open →
        </Link>
      </div>
      <ul className="flex flex-col gap-0.5">
        {fields.map((f, i) => (
          <li key={i} className={f.starred ? 'text-gray-800' : 'text-gray-600'}>
            <span className="text-gray-400">{f.label}:</span> {f.value}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The 2e decisions recap: purpose, chosen genre, the big-picture decisions from
 * 2c, the Required features with the team's plans from 2d, and any starred
 * priorities — everything decided so far, in view while drafting.
 */
function TranslationSummaryBlock({ ctx }: { ctx: ActiveContext }) {
  const entries = useAllEntries(ctx)
  if (entries === undefined) return null
  const s = translationSummary(entries, ctx.focusTextId, ctx.worksheetId)
  const macro = macroDecisions(entries, ctx.worksheetId)
  const required = requiredFeatureRefs(entries, ctx.genreId).map((f) => {
    const idea = entries.find(
      (e) =>
        e.node_id === STYLE_IDEA_NODE &&
        e.worksheet_id === ctx.worksheetId &&
        e.cell_key === `${f.tableId}__${f.rowId}`,
    )
    return { ...f, idea: (idea?.text ?? '').trim() }
  })
  const empty =
    s.purpose.length === 0 &&
    !s.chosenGenre &&
    s.priorities.length === 0 &&
    macro.length === 0 &&
    required.length === 0
  if (empty) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <div className="mb-2 font-semibold text-gray-700">What you have decided so far</div>
      {s.chosenGenre && (
        <p className="mb-1 text-gray-700">
          <span className="text-gray-400">Chosen genre:</span> {s.chosenGenre}
        </p>
      )}
      {s.purpose.length > 0 && (
        <ul className="mb-1 flex flex-col gap-0.5">
          {s.purpose.map((f, i) => (
            <li key={i} className="text-gray-700">
              <span className="text-gray-400">{f.label}:</span> {f.value}
            </li>
          ))}
        </ul>
      )}
      {macro.length > 0 && (
        <>
          <div className="mt-2 text-xs font-medium text-gray-500">
            Big-picture decisions (from 2c)
          </div>
          {macro.map((g, gi) => (
            <div key={gi} className="mb-1">
              <div className="text-[11px] text-gray-400">{g.group}</div>
              <ul className="flex flex-col gap-0.5">
                {g.fields.map((f, i) => (
                  <li key={i} className="text-gray-700">
                    <span className="text-gray-400">{f.label}:</span> {f.value}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      {required.length > 0 && (
        <>
          <div className="mt-2 text-xs font-medium text-gray-500">
            Required features &amp; your plans (from 2d)
          </div>
          <ul className="flex flex-col gap-0.5">
            {required.map((f, i) => (
              <li key={i} className="text-gray-700">
                <span className="text-gray-400">{f.areaLabel}:</span>{' '}
                {f.idea ? `${f.text} → ${f.idea}` : `${f.text} (no plan yet)`}
              </li>
            ))}
          </ul>
        </>
      )}
      {s.priorities.length > 0 && (
        <>
          <div className="mt-2 text-xs font-medium text-gray-500">Your starred priorities</div>
          <ul className="flex flex-col gap-0.5">
            {s.priorities.map((f, i) => (
              <li key={i} className="text-gray-700">
                <span className="text-amber-500">★</span>{' '}
                <span className="text-gray-400">{f.label}:</span> {f.value}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
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
          // Clicking the selected option again clears it, so a team can back out
          // of a guess instead of being forced to keep one choice (feedback #17).
          onClick={() =>
            upsertEntry(ctx, node.id, layer, { value: entry?.value === o.id ? '' : o.id })
          }
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
  const custom = useCustomOptions(ctx.projectId, node.id)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    upsertEntry(ctx, node.id, layer, { value: JSON.stringify(next) })
  }
  const options = node.allowCustomOptions ? mergeOptions(node, custom) : (node.options ?? [])
  const saveCustom = async () => {
    const opt = await addCustomOption(ctx.projectId, node, draft)
    if (opt && !selected.includes(opt.id)) toggle(opt.id)
    setDraft('')
    setAdding(false)
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
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
      {node.allowCustomOptions &&
        (adding ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveCustom()
                if (e.key === 'Escape') setAdding(false)
              }}
              placeholder="Name the purpose"
              className="w-40 rounded-full border border-gray-400 px-3 py-1 text-sm focus:border-gray-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void saveCustom()}
              className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-1 text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-full border border-dashed border-gray-400 px-3 py-1 text-sm text-gray-500 hover:bg-gray-50"
          >
            + Other…
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
      {rowIds.length > 0 && (
        <p className="text-[11px] text-gray-400">
          <span className="text-violet-500">⚑</span> Flag one to come back to it later.
          {node.priorityEligible && <> <span className="text-amber-500">★</span> marks your most important.</>}
        </p>
      )}
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
      {node.rowSource && <SectionRecall ctx={ctx} sourceSubId={node.rowSource} />}
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
        <div className="flex min-w-0 items-center gap-2">
          {/* Star is reachable while the row is open, so the last/new entry can be
              starred without adding another row (feedback #26). */}
          {node.priorityEligible && (
            <PriorityStar ctx={ctx} nodeId={node.id} layer={layer} rowId={rowId} />
          )}
          <span className="min-w-0 truncate text-sm font-medium text-gray-800">{header}</span>
        </div>
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
          {col.help && <ColumnHelp text={col.help} />}
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

/**
 * Explainer behind a "What do these mean?" toggle, shown above a column's input
 * when the content config supplies `help`. The text (including its concrete
 * example) lives in the config so app translations can localize it.
 */
function ColumnHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const genre = useGenreName()
  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-sky-700 hover:underline"
      >
        {open ? 'Hide explanation' : 'What do these mean?'}
      </button>
      {open && (
        <p className="mt-1 rounded-md bg-sky-50 p-2 text-xs text-sky-900">
          {resolveGenreTokens(text, genre)}
        </p>
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
