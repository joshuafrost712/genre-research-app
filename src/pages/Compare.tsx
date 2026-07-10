import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useAllEntries, useEntry, upsertEntry } from '../lib/storage/entries'
import { ensureWorksheetFor, type ActiveContext } from '../lib/storage/appState'
import { AutosaveText } from '../components/blocks/AutosaveText'
import {
  psalmIdentity,
  psalmReminder,
  genreIdentity,
  genreLinking,
  genreWords,
  type SummaryField,
} from '../lib/content/compareSummary'

/**
 * Compare fit: the active psalm beside a chosen genre, across three lenses
 * (Matching / Big picture / Words). Each lens shows a condensed psalm summary, a
 * blank "how we'll translate this" box, and a condensed genre summary, so the
 * translator can judge fit and capture the bridge in one place. The genre is
 * switchable across the project's candidate genres; the middle boxes are
 * synthesis-layer answers, kept per psalm-and-genre pairing.
 */
interface Lens {
  key: string
  title: string
  step: string
  /** Worksheet subsection holding the genre-side research, for the empty hint. */
  genreTo: string
  /** Stable synthesis node id for this lens's translation-approach box. */
  node: string
  prompt: string
}

const LENSES: Lens[] = [
  {
    key: 'match',
    title: 'Matching',
    step: '1C',
    genreTo: 's1b',
    node: 'compare.match',
    prompt: 'How will you adapt this genre so it carries the psalm’s message and purpose? What problems might there be, and how will you handle them?',
  },
  {
    key: 'bigpicture',
    title: 'Big picture — linking ideas',
    step: '2E',
    genreTo: 's2d',
    node: 'compare.bigpicture',
    prompt: 'How will you use this genre’s ways of linking ideas to show the psalm’s connections (repeated words, matching lines, related ideas)?',
  },
  {
    key: 'words',
    title: 'Words',
    step: '3A',
    genreTo: 's3a',
    node: 'compare.words',
    prompt: 'How will you translate the psalm’s wording using this genre’s word conventions (set phrases, wordplay, special constructions)?',
  },
]

export function Compare() {
  const { ctx } = useActiveContext()
  const entries = useAllEntries(ctx)
  const genres = useLiveQuery(
    async () => (ctx ? await db.genres.where('project_id').equals(ctx.projectId).toArray() : []),
    [ctx?.projectId],
  )
  const focusText = useLiveQuery(
    async () => (ctx ? await db.focusTexts.get(ctx.focusTextId) : undefined),
    [ctx?.focusTextId],
  )

  const [selectedGenreId, setSelectedGenreId] = useState('')
  const [worksheetId, setWorksheetId] = useState('')

  // Default the comparison to the active genre once context resolves.
  useEffect(() => {
    if (ctx && !selectedGenreId) setSelectedGenreId(ctx.genreId)
  }, [ctx, selectedGenreId])

  // Resolve the (psalm × selected genre) worksheet so the middle boxes persist
  // per genre, without disturbing the global active worksheet.
  const projectId = ctx?.projectId
  const focusTextId = ctx?.focusTextId
  useEffect(() => {
    if (!projectId || !focusTextId || !selectedGenreId) return
    let cancelled = false
    setWorksheetId('')
    ensureWorksheetFor(projectId, focusTextId, selectedGenreId).then((w) => {
      if (!cancelled) setWorksheetId(w.id)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, focusTextId, selectedGenreId])

  if (!ctx || entries === undefined || genres === undefined) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  if (genres.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Compare fit</h1>
        <p className="text-sm text-gray-500">
          Add a genre first, then come back to compare it with your psalm.{' '}
          <Link to="/genres" className="text-sky-700 hover:underline">
            Go to Genres &amp; psalms
          </Link>
        </p>
      </div>
    )
  }

  const selectedGenre = genres.find((g) => g.id === selectedGenreId)
  const genreName =
    selectedGenre && !selectedGenre.name.startsWith('Untitled') ? selectedGenre.name : 'this genre'
  const psalmRef = focusText?.reference?.trim() || 'this psalm'

  const synthCtx: ActiveContext | null =
    worksheetId ? { projectId: ctx.projectId, focusTextId: ctx.focusTextId, genreId: selectedGenreId, worksheetId } : null

  const psalmFor = (lens: Lens): SummaryField[] =>
    lens.key === 'match' ? psalmIdentity(entries, ctx.focusTextId) : psalmReminder(entries, ctx.focusTextId)

  const genreFor = (lens: Lens): SummaryField[] =>
    lens.key === 'match'
      ? genreIdentity(entries, selectedGenreId)
      : lens.key === 'bigpicture'
        ? genreLinking(entries, selectedGenreId)
        : genreWords(entries, selectedGenreId)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Compare fit</h1>
        <p className="mt-1 text-sm text-gray-500">
          See your psalm beside a genre, and note how you will carry it across.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-sky-700">{psalmRef}</span>
        <span className="text-gray-300">↔</span>
        <label className="sr-only" htmlFor="compare-genre">
          Genre to compare
        </label>
        <select
          id="compare-genre"
          value={selectedGenreId}
          onChange={(e) => setSelectedGenreId(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm font-medium text-emerald-700 focus:border-gray-500 focus:outline-none"
        >
          {genres.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name.startsWith('Untitled') ? 'Untitled genre' : g.name}
            </option>
          ))}
        </select>
      </div>

      {LENSES.map((lens) => (
        <section key={lens.key} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">
              {lens.step}
            </span>
            <h2 className="text-base font-semibold text-gray-800">{lens.title}</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <SummaryColumn
              heading={`Psalm · ${psalmRef}`}
              accent="text-sky-700"
              fields={psalmFor(lens)}
              emptyTo="/worksheet/s0.purpose"
            />

            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                How we’ll translate this
              </div>
              <TranslateBox ctx={synthCtx} nodeId={lens.node} placeholder={lens.prompt} />
            </div>

            <SummaryColumn
              heading={`Genre · ${genreName}`}
              accent="text-emerald-700"
              fields={genreFor(lens)}
              emptyTo={`/worksheet/${lens.genreTo}`}
            />
          </div>
        </section>
      ))}
    </div>
  )
}

function SummaryColumn({
  heading,
  accent,
  fields,
  emptyTo,
}: {
  heading: string
  accent: string
  fields: SummaryField[]
  emptyTo: string
}) {
  return (
    <div>
      <div className={`mb-2 truncate text-xs font-semibold uppercase tracking-wide ${accent}`}>
        {heading}
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-gray-400">
          Not filled in yet.{' '}
          <Link to={emptyTo} className="text-sky-700 hover:underline">
            Open
          </Link>
        </p>
      ) : (
        <dl className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <div key={i}>
              <dt className="text-[11px] font-medium text-gray-400">{f.label}</dt>
              <dd className="whitespace-pre-wrap text-sm text-gray-800">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** The editable translation-approach box for one lens (synthesis layer). */
function TranslateBox({
  ctx,
  nodeId,
  placeholder,
}: {
  ctx: ActiveContext | null
  nodeId: string
  placeholder: string
}) {
  const entry = useEntry(ctx, nodeId, 'synthesis')
  return (
    <AutosaveText
      value={entry?.text ?? ''}
      multiline
      placeholder={placeholder}
      onSave={(next) => (ctx ? upsertEntry(ctx, nodeId, 'synthesis', { text: next }) : undefined)}
    />
  )
}
