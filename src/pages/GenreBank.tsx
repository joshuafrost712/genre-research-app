import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import {
  createFocusText,
  createGenre,
  renameFocusText,
  renameGenre,
  setActiveFocusText,
  setActiveGenre,
} from '../lib/storage/appState'
import { genreLayerStages, type GenreStage } from '../lib/content/loader'
import { genreProgress } from '../lib/progress'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useDepthMode } from '../components/DepthModeContext'
import { useAllEntries } from '../lib/storage/entries'
import { Tour, ReplayTourButton } from '../components/tour/TourProvider'
import { GENRES_TOUR, GENRES_TOUR_STEPS } from '../components/tour/tours'

/**
 * Genres hub. The genre list is the spine of the work: each genre is a card that
 * shows how far its research has come (Details / Big picture / Style) and how
 * many follow-up flags sit on it. Tapping a card makes it the active genre and
 * opens its research. The active focus text drives Section 0 and 1A/1C; the
 * active genre drives the reusable genre analysis; switching here re-points the
 * worksheet without losing data.
 */
export function GenreBank() {
  const { ctx, reload } = useActiveContext()
  const { mode } = useDepthMode()
  const navigate = useNavigate()
  const entries = useAllEntries(ctx)

  const focusTexts = useLiveQuery(
    async () => (ctx ? await db.focusTexts.where('project_id').equals(ctx.projectId).toArray() : []),
    [ctx?.projectId],
  )
  const genres = useLiveQuery(
    async () => (ctx ? await db.genres.where('project_id').equals(ctx.projectId).toArray() : []),
    [ctx?.projectId],
  )

  if (!ctx) return <p className="text-sm text-gray-400">Loading…</p>

  const stages = genreLayerStages()
  const firstSubId = stages[0]?.subIds[0]

  const openGenre = async (id: string) => {
    await setActiveGenre(ctx.projectId, id)
    reload()
    if (firstSubId) navigate(`/worksheet/${firstSubId}`)
  }

  return (
    <div className="flex flex-col gap-8">
      <Tour id={GENRES_TOUR} steps={GENRES_TOUR_STEPS} />

      <div>
        <Link to="/" className="text-sm text-sky-700 hover:underline">
          ← Home
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Passages &amp; Genres</h1>
          <ReplayTourButton id={GENRES_TOUR} />
        </div>
        <p className="mt-1 text-sm text-gray-600">
          A genre is a type of song or poem your people use. Add the ones you want
          to study, and add the passage you are translating. Tap a genre to work on it.
          If needed, you can begin the process of identifying local genres in{' '}
          <Link to="/worksheet/s1a" className="text-sky-700 hover:underline">
            Workspace 1: Find Local Genres
          </Link>
          .
        </p>
      </div>

      <EntityList
        title="Passages (the text you are translating)"
        addLabel="Add a passage (e.g. Psalm 13)"
        items={(focusTexts ?? []).map((f) => ({ id: f.id, label: f.reference }))}
        activeId={ctx.focusTextId}
        onSelect={async (id) => {
          await setActiveFocusText(ctx.projectId, id)
          reload()
        }}
        onCreate={async (label) => {
          await createFocusText(ctx.projectId, label)
          reload()
        }}
        onRename={(id, label) => renameFocusText(id, label)}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Genres (local song &amp; poem types)</h2>
        <div className="flex flex-col gap-2">
          {(genres ?? []).map((g) => (
            <GenreCard
              key={g.id}
              id={g.id}
              name={g.name}
              active={g.id === ctx.genreId}
              stages={stages}
              progress={genreProgress(entries ?? [], ctx.projectId, g.id, mode)}
              followUps={(entries ?? []).filter((e) => e.genre_id === g.id && e.is_concern_flag).length}
              onOpen={() => openGenre(g.id)}
              onRename={(label) => renameGenre(g.id, label)}
            />
          ))}
        </div>
        <AddRow addLabel="Add genre" onCreate={async (label) => {
          await createGenre(ctx.projectId, label)
          reload()
        }} />
      </section>

      <p className="text-sm text-gray-500">
        Genre study is reusable: the same genre can be paired with several passages,
        and editing it updates information about it everywhere.
      </p>
    </div>
  )
}

/** Short names for the per-genre stage chips, keyed by top-level section id. */
const SHORT_STAGE: Record<string, string> = {
  s1: 'Basics & social',
  s2: 'Big picture',
  s3: 'Style & details',
}

function GenreCard({
  name,
  active,
  stages,
  progress,
  followUps,
  onOpen,
  onRename,
}: {
  id: string
  name: string
  active: boolean
  stages: GenreStage[]
  progress: { overall: { done: number; total: number }; bySubsection: Record<string, { done: number; total: number }> }
  followUps: number
  onOpen: () => void
  onRename: (label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(name)
  const pct = progress.overall.total > 0
    ? Math.round((progress.overall.done / progress.overall.total) * 100)
    : 0

  return (
    <div
      className={`rounded-xl border bg-white p-4 ${active ? 'border-gray-800 ring-1 ring-gray-800' : 'border-gray-200'}`}
    >
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { onRename(text); setEditing(false) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { onRename(text); setEditing(false) } }}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none"
          />
        ) : (
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
            <span className="text-base font-medium text-gray-900">{name}</span>
            {active && <span className="ml-2 text-[11px] font-medium text-emerald-600">active</span>}
          </button>
        )}
        <button
          type="button"
          onClick={() => { setText(name); setEditing((v) => !v) }}
          className="shrink-0 text-xs text-gray-400 hover:text-gray-700"
        >
          {editing ? 'cancel' : 'rename'}
        </button>
      </div>

      <button type="button" onClick={onOpen} className="mt-3 block w-full text-left">
        <div className="mb-1 flex justify-between text-xs text-gray-500">
          <span>Research progress</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100">
          <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {stages.map((stage) => {
            const c = sumStage(stage, progress.bySubsection)
            const done = c.total > 0 && c.done >= c.total
            return (
              <span key={stage.sectionId} className={done ? 'text-emerald-700' : ''}>
                {done ? '✓ ' : ''}
                {SHORT_STAGE[stage.sectionId] ?? stage.sectionLabel}: {c.done}/{c.total}
              </span>
            )
          })}
        </div>
      </button>

      {followUps > 0 && (
        <div className="mt-2 text-xs font-medium text-violet-700">
          {followUps} follow-up {followUps === 1 ? 'flag' : 'flags'}
        </div>
      )}
    </div>
  )
}

function sumStage(
  stage: GenreStage,
  bySubsection: Record<string, { done: number; total: number }>,
): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const subId of stage.subIds) {
    const c = bySubsection[subId]
    if (c) {
      done += c.done
      total += c.total
    }
  }
  return { done, total }
}

interface Item {
  id: string
  label: string
}

function EntityList({
  title,
  addLabel,
  items,
  activeId,
  onSelect,
  onCreate,
  onRename,
}: {
  title: string
  addLabel: string
  items: Item[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (label: string) => void
  onRename: (id: string, label: string) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <Row key={it.id} item={it} active={it.id === activeId} onSelect={onSelect} onRename={onRename} />
        ))}
      </ul>
      <AddRow addLabel={addLabel} onCreate={onCreate} />
    </section>
  )
}

function AddRow({ addLabel, onCreate }: { addLabel: string; onCreate: (label: string) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={addLabel}
        className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          if (!draft.trim()) return
          onCreate(draft)
          setDraft('')
        }}
        className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        Add
      </button>
    </div>
  )
}

function Row({
  item,
  active,
  onSelect,
  onRename,
}: {
  item: Item
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.label)

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 ${
        active ? 'border-gray-800' : 'border-gray-200'
      }`}
    >
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            onRename(item.id, text)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(item.id, text)
              setEditing(false)
            }
          }}
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none"
        />
      ) : (
        <button type="button" onClick={() => onSelect(item.id)} className="flex-1 text-left text-sm">
          {item.label}
          {active && <span className="ml-2 text-[11px] font-medium text-emerald-600">active</span>}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setText(item.label)
          setEditing((v) => !v)
        }}
        className="shrink-0 text-xs text-gray-400 hover:text-gray-700"
      >
        {editing ? 'cancel' : 'rename'}
      </button>
    </li>
  )
}
