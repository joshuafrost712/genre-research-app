import { useMemo, useState } from 'react'
import { findNode, routableNodes } from '../lib/content/loader'
import {
  createCapturedNote,
  routeNoteToNode,
  useEntriesForNote,
  useNotes,
} from '../lib/storage/notes'
import { useActiveContext } from '../components/ActiveContextProvider'
import type { CapturedNote } from '../lib/types'

/**
 * Capture screen. The facilitator dictates an observation (Wispr / native
 * dictation into the textarea), saves it as an immutable note, then routes it to
 * one or more worksheet nodes. Routing is manual for the MVP; the AI proposes it
 * later. Nothing files silently.
 */
export function Capture() {
  const { ctx } = useActiveContext()
  const notes = useNotes(ctx)
  const [draft, setDraft] = useState('')
  const [activeNote, setActiveNote] = useState<CapturedNote | null>(null)

  if (!ctx) return <p className="text-sm text-gray-400">Loading…</p>

  const saveNote = async () => {
    const text = draft.trim()
    if (!text) return
    const note = await createCapturedNote(ctx, text)
    setDraft('')
    setActiveNote(note)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Capture a note</h1>
        <p className="mt-1 text-sm text-gray-500">
          Dictate or type an observation, save it, then route it to where it
          belongs. One note can land in several places.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Dictate the observation here…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={saveNote}
          disabled={!draft.trim()}
          className="self-start rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Save note
        </button>
      </div>

      {activeNote && (
        <RoutePanel note={activeNote} onClose={() => setActiveNote(null)} />
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Recent notes</h2>
        {notes === undefined ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-gray-500">No notes captured yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                onRoute={() => setActiveNote(n)}
                active={activeNote?.id === n.id}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function NoteRow({
  note,
  onRoute,
  active,
}: {
  note: CapturedNote
  onRoute: () => void
  active: boolean
}) {
  const { ctx } = useActiveContext()
  const derived = useEntriesForNote(ctx, note.id) ?? []
  return (
    <li
      className={`rounded-lg border bg-white p-3 ${
        active ? 'border-gray-800' : 'border-gray-200'
      }`}
    >
      <p className="whitespace-pre-wrap text-sm text-gray-800">{note.raw_text}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {derived.length} placement{derived.length === 1 ? '' : 's'}
          {derived.length > 0 &&
            ': ' +
              derived
                .map((e) => findNode(e.node_id)?.node.label ?? e.node_id)
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(', ')}
        </span>
        <button
          type="button"
          onClick={onRoute}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Route…
        </button>
      </div>
    </li>
  )
}

function RoutePanel({ note, onClose }: { note: CapturedNote; onClose: () => void }) {
  const { ctx } = useActiveContext()
  const [filter, setFilter] = useState('')
  const [routedIds, setRoutedIds] = useState<string[]>([])
  const targets = useMemo(() => routableNodes(), [])

  const filtered = targets.filter((t) => {
    const hay = `${t.sectionLabel} ${t.subLabel} ${t.node.label}`.toLowerCase()
    return hay.includes(filter.toLowerCase())
  })

  const route = async (nodeId: string) => {
    if (!ctx) return
    const target = targets.find((t) => t.node.id === nodeId)
    if (!target) return
    await routeNoteToNode(ctx, note, target.node)
    setRoutedIds((ids) => [...ids, nodeId])
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Route this note</h2>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:underline">
          Done
        </button>
      </div>
      <p className="mb-2 rounded bg-white p-2 text-xs text-gray-600">{note.raw_text}</p>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter sections…"
        className="mb-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
      />
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {filtered.map((t) => {
          const done = routedIds.includes(t.node.id)
          return (
            <li key={t.node.id} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate text-sm text-gray-800">{t.node.label}</div>
                <div className="truncate text-[11px] text-gray-400">
                  {t.sectionLabel} · {t.subLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => route(t.node.id)}
                disabled={done}
                className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                  done
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-800 text-white hover:bg-gray-700'
                }`}
              >
                {done ? 'Routed ✓' : 'Route here'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
