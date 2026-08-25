import { useEffect, useMemo, useRef, useState } from 'react'
import { findNode, routableNodes } from '../lib/content/loader'
import {
  createCapturedNote,
  dismissCapturedNote,
  noteAuthorOf,
  restoreCapturedNote,
  routeNoteToNode,
  useEntriesForNote,
  useNotes,
} from '../lib/storage/notes'
import { getMetaValue, setMetaValue } from '../lib/storage/appState'
import { useSupabaseSession } from '../lib/supabase/session'
import { useActiveContext } from '../components/ActiveContextProvider'
import type { CapturedNote } from '../lib/types'

/**
 * Capture screen. The facilitator dictates an observation (Wispr / native
 * dictation into the textarea), saves it as an immutable note, then routes it to
 * one or more worksheet nodes. Routing is manual for the MVP; the AI proposes it
 * later. Nothing files silently.
 */

/**
 * Where the in-progress draft is parked between keystrokes.
 *
 * This screen used to hold the draft in React state alone, so it reached the
 * database only when someone tapped "Save note". Everything typed before that
 * click lived in memory and nowhere else: a crash, a closed tab, a dead battery
 * or a storage eviction took the whole dictation, and having an account did not
 * help, because nothing had been written for the account to receive. Every
 * worksheet field on the other screens has autosaved for months (`AutosaveText`,
 * 400ms plus a blur flush); the longest single piece of text in the app was the
 * one place that did not.
 *
 * The DRAFT is persisted, not a note. "Nothing files silently" above is still
 * true: an unsaved draft is working text that reappears where you left it, and it
 * becomes a `CapturedNote` only when a person says so.
 *
 * `AutosaveText` is the wrong tool here despite the overlap — it saves through to
 * an `Entry`, and a draft is not one yet.
 */
const CAPTURE_DRAFT = 'captureDraft'
const DRAFT_DEBOUNCE_MS = 400

export function Capture() {
  const { ctx } = useActiveContext()
  const { user } = useSupabaseSession()
  const notes = useNotes(ctx)
  // One list, split here: the management page shows both halves (recent +
  // archived-with-restore), so it deliberately uses useNotes, not useActiveNotes.
  const active = (notes ?? []).filter((n) => !n.dismissed_at)
  const archived = (notes ?? []).filter((n) => n.dismissed_at)
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState('')
  const [activeNote, setActiveNote] = useState<CapturedNote | null>(null)
  // Until the stored draft has been read, an empty box means "not loaded yet",
  // not "the person cleared it". Writing before then would erase the very draft
  // this is meant to restore.
  const loaded = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void (async () => {
      const saved = await getMetaValue(CAPTURE_DRAFT)
      if (!alive) return
      // Only adopt the stored draft if nothing has been typed in the meantime.
      if (saved) setDraft((current) => (current === '' ? saved : current))
      loaded.current = true
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const changeDraft = (next: string) => {
    setDraft(next)
    if (!loaded.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void setMetaValue(CAPTURE_DRAFT, next), DRAFT_DEBOUNCE_MS)
  }

  if (!ctx) return <p className="text-sm text-gray-400">Loading…</p>

  const saveNote = async () => {
    const text = draft.trim()
    if (!text) return
    const note = await createCapturedNote(ctx, text, undefined, noteAuthorOf(user))
    // Clear the parked draft only after the note exists, and cancel any pending
    // debounced write first, or a timer that fires a moment later resurrects the
    // text the person has just filed.
    clearTimeout(timer.current)
    await setMetaValue(CAPTURE_DRAFT, '')
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
          onChange={(e) => changeDraft(e.target.value)}
          onBlur={() => {
            // Flush immediately on blur, matching AutosaveText: leaving the field
            // is the moment a person expects their text to be safe.
            if (loaded.current) {
              clearTimeout(timer.current)
              void setMetaValue(CAPTURE_DRAFT, draft)
            }
          }}
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
        ) : active.length === 0 ? (
          <p className="text-sm text-gray-500">No notes captured yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((n) => (
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

      {archived.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="self-start text-sm font-semibold text-gray-500 hover:text-gray-700"
          >
            {showArchived ? '− ' : '+ '}Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="flex flex-col gap-2">
              {archived.map((n) => (
                <ArchivedNoteRow key={n.id} note={n} />
              ))}
            </ul>
          )}
        </div>
      )}
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
  const [expanded, setExpanded] = useState(false)
  const used = derived.length > 0
  return (
    <li
      className={`rounded-lg border bg-white p-3 ${
        active ? 'border-gray-800' : 'border-gray-200'
      }`}
    >
      <p className="whitespace-pre-wrap text-sm text-gray-800">{note.raw_text}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-400">
          {note.author_label && (
            <span className="font-medium text-gray-500">{note.author_label}</span>
          )}
          {used ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100"
              title="Show where this note was inserted"
            >
              inserted ×{derived.length} {expanded ? '−' : '+'}
            </button>
          ) : (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">
              not inserted yet
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void dismissCapturedNote(note)}
            aria-label="Archive"
            title="Archive this note (restorable below)"
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
          >
            ✕
          </button>
          <button
            type="button"
            onClick={onRoute}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Route…
          </button>
        </span>
      </div>
      {expanded && used && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
          {derived.map((e) => (
            <li key={e.id} className="text-xs">
              <span className="font-medium text-gray-600">
                {findNode(e.node_id)?.node.label ?? e.node_id}
              </span>
              {e.text && (
                <span className="text-gray-400"> — {snippet(e.text)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

/** First ~90 chars of what the answer looks like now, one line. */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat
}

function ArchivedNoteRow({ note }: { note: CapturedNote }) {
  const { ctx } = useActiveContext()
  const derived = useEntriesForNote(ctx, note.id) ?? []
  return (
    <li className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="whitespace-pre-wrap text-sm text-gray-500">{note.raw_text}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">
          {derived.length > 0
            ? `inserted ×${derived.length} (kept)` // provenance survives the archive
            : 'never inserted'}
        </span>
        <button
          type="button"
          onClick={() => void restoreCapturedNote(note)}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-white"
        >
          Restore
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
