import { useState } from 'react'
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
import { useActiveContext } from '../components/ActiveContextProvider'

/**
 * Genres & focus texts. The active focus text drives the Section 0 purpose; the
 * active genre drives the reusable genre analysis (1B, Sections 2 and 3); the
 * pairing drives the synthesis. Switching here re-points the worksheet without
 * losing any data, since genre analysis is reusable across focus texts.
 */
export function GenreBank() {
  const { ctx, reload } = useActiveContext()

  const focusTexts = useLiveQuery(
    async () => (ctx ? await db.focusTexts.where('project_id').equals(ctx.projectId).toArray() : []),
    [ctx?.projectId],
  )
  const genres = useLiveQuery(
    async () => (ctx ? await db.genres.where('project_id').equals(ctx.projectId).toArray() : []),
    [ctx?.projectId],
  )

  if (!ctx) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Your psalms &amp; genres</h1>
      <p className="text-sm text-gray-600">
        Name the psalm you are translating and the genre you are studying. Tap one to
        make it the one you are working on now. You can come back and switch any time.
      </p>

      <EntityList
        title="Psalms (the text you are translating)"
        addLabel="Add a psalm (e.g. Psalm 13)"
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

      <EntityList
        title="Genres"
        addLabel="Add genre"
        items={(genres ?? []).map((g) => ({ id: g.id, label: g.name }))}
        activeId={ctx.genreId}
        onSelect={async (id) => {
          await setActiveGenre(ctx.projectId, id)
          reload()
        }}
        onCreate={async (label) => {
          await createGenre(ctx.projectId, label)
          reload()
        }}
        onRename={(id, label) => renameGenre(id, label)}
      />

      <p className="text-sm text-gray-500">
        Genre analysis is reusable: the same genre can be paired with several focus
        texts, and editing it updates everywhere.
      </p>
    </div>
  )
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
  const [draft, setDraft] = useState('')

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <Row key={it.id} item={it} active={it.id === activeId} onSelect={onSelect} onRename={onRename} />
        ))}
      </ul>
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
    </section>
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
