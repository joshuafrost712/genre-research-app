/**
 * The field-side half of the jot workflow. Interviews wander: an answer for
 * another page arrives mid-conversation, gets captured as a jot (QuickJot /
 * Capture), and this button — mounted under every text-capable answer area —
 * lets the interviewer pull it in the moment they reach the right box, instead
 * of leaving the page to route it.
 *
 * One live query per PAGE, not per field: WorksheetView wraps its blocks in
 * <JotNotesProvider>, and every button reads the shared list from context. A
 * button renders nothing when no active jots exist (a teaching hint under every
 * field would be worse than none; the Capture page teaches the feature).
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/storage/db'
import {
  dismissCapturedNote,
  restoreCapturedNote,
  routeNoteToNode,
  splitCapturedNote,
  splitSegments,
  useActiveNotes,
  type RoutePlacement,
} from '../../lib/storage/notes'
import { NotePlacementList } from './NotePlacements'
import { SplitPreview } from './SplitPreview'
import type { Entry } from '../../lib/types'
import { useActiveContext } from '../ActiveContextProvider'
import { useLocale } from '../../lib/i18n/LocaleContext'
import { useSupabaseSession } from '../../lib/supabase/session'
import { ModalDialog } from './Dialog'
import type { ActiveContext } from '../../lib/storage/appState'
import type { CapturedNote } from '../../lib/types'
import type { GuideNode } from '../../schema/types'

const JotNotesContext = createContext<CapturedNote[] | undefined>(undefined)

/** Mounted once per worksheet page; buttons below read this shared list. */
export function JotNotesProvider({ children }: { children: ReactNode }) {
  const { ctx } = useActiveContext()
  const notes = useActiveNotes(ctx)
  return <JotNotesContext.Provider value={notes}>{children}</JotNotesContext.Provider>
}

const SEARCH_THRESHOLD = 5

interface JotInsertButtonProps {
  ctx: ActiveContext
  node: GuideNode
  /** Called after a successful insert (tables use it to open the new row). */
  onInserted?: (placement: RoutePlacement) => void
}

export function JotInsertButton({ ctx, node, onInserted }: JotInsertButtonProps) {
  const notes = useContext(JotNotesContext)
  const { t } = useLocale()
  const [open, setOpen] = useState(false)

  if (!notes?.length) return null

  const openPicker = () => {
    // Clobber guard, load-bearing: on Safari, tapping a button does not blur a
    // focused input, so a field the user just typed in still holds its stale
    // local value and its AutosaveText suppresses external adoption while
    // focused. Blurring HERE (tap 1) makes the field flush and re-adopt before
    // any insert can happen (tap 2), a full human interaction later. Without
    // this, the eventual blur-flush overwrites the inserted jot silently.
    const el = document.activeElement
    if (el instanceof HTMLElement) el.blur()
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="self-start rounded-md border border-dashed border-violet-300 px-2.5 py-1 text-xs text-violet-700 hover:border-violet-400 hover:bg-violet-50"
      >
        ✎ {t('jot.insert')}
      </button>
      {open && (
        <JotPickerDialog
          ctx={ctx}
          node={node}
          notes={notes}
          onInserted={onInserted}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function JotPickerDialog({
  ctx,
  node,
  notes,
  onInserted,
  onClose,
}: JotInsertButtonProps & { notes: CapturedNote[]; onClose: () => void }) {
  const { t } = useLocale()
  const { user } = useSupabaseSession()
  const [filter, setFilter] = useState('')
  const [insertedIds, setInsertedIds] = useState<string[]>([])
  const [archived, setArchived] = useState<CapturedNote | null>(null)

  // One aggregate query for the whole dialog (not one per note): which jots
  // have already landed somewhere, where, and how often. The full Entry list is
  // already materialized by the query; the map keeps references, not copies.
  const placements = useLiveQuery(async () => {
    const entries = await db.entries.where('project_id').equals(ctx.projectId).toArray()
    const byNote = new Map<string, Entry[]>()
    for (const e of entries) {
      if (e.captured_note_id) {
        const list = byNote.get(e.captured_note_id)
        if (list) list.push(e)
        else byNote.set(e.captured_note_id, [e])
      }
    }
    return byNote
  }, [ctx.projectId])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return notes
    return notes.filter(
      (n) =>
        n.raw_text.toLowerCase().includes(q) ||
        n.author_label?.toLowerCase().includes(q),
    )
  }, [notes, filter])

  const insert = async (note: CapturedNote) => {
    const placement = await routeNoteToNode(ctx, note, node)
    setInsertedIds((ids) => [...ids, note.id])
    if (placement) onInserted?.(placement)
  }

  const archive = async (note: CapturedNote) => {
    const updated = await dismissCapturedNote(note)
    setArchived(updated)
  }

  return (
    <ModalDialog onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{t('jot.pickerTitle')}</h2>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:underline">
          {t('jot.done')}
        </button>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">{t('jot.pickerHint')}</p>

      {archived && (
        <div className="mb-2 flex items-center justify-between rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-600">
          <span>{t('jot.archivedRow')}</span>
          <button
            type="button"
            onClick={async () => {
              await restoreCapturedNote(archived)
              setArchived(null)
            }}
            className="font-medium text-violet-700 hover:underline"
          >
            {t('jot.undo')}
          </button>
        </div>
      )}

      {notes.length > SEARCH_THRESHOLD && (
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t('jot.search')}
          className="mb-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">{t('jot.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((n) => (
            <JotRow
              key={n.id}
              note={n}
              entries={placements?.get(n.id) ?? []}
              inserted={insertedIds.includes(n.id)}
              isMine={!!user && n.author_id === user.id}
              onInsert={() => insert(n)}
              onArchive={() => archive(n)}
              onSplit={(segments) => splitCapturedNote(ctx, n, segments)}
            />
          ))}
        </ul>
      )}
    </ModalDialog>
  )
}

function JotRow({
  note,
  entries,
  inserted,
  isMine,
  onInsert,
  onArchive,
  onSplit,
}: {
  note: CapturedNote
  /** Entries this jot was inserted into (the picker's aggregate map). */
  entries: Entry[]
  inserted: boolean
  isMine: boolean
  onInsert: () => void
  onArchive: () => void
  onSplit: (segments: string[]) => Promise<unknown>
}) {
  const { t } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const [splitting, setSplitting] = useState(false)
  // "You" only on an author_id match. A pre-feature jot carries no author and
  // may be anyone's, so it gets no label rather than a wrong one.
  const author = isMine ? t('jot.you') : note.author_label
  const usedCount = entries.length
  const segments = useMemo(() => splitSegments(note.raw_text), [note.raw_text])

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left"
        title={expanded ? undefined : note.raw_text}
      >
        <p
          className={`whitespace-pre-wrap text-sm text-gray-800 ${expanded ? '' : 'line-clamp-2'}`}
        >
          {note.raw_text}
        </p>
      </button>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-2 text-[11px] text-gray-400">
          {author && <span className="truncate font-medium text-gray-500">{author}</span>}
          <span className="shrink-0">{timeAgo(note.created_at)}</span>
          {usedCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100"
            >
              {t('jot.used', { n: usedCount })} {expanded ? '−' : '+'}
            </button>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {expanded && segments.length >= 2 && !splitting && (
            <button
              type="button"
              onClick={() => setSplitting(true)}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            >
              {t('jot.split')}
            </button>
          )}
          <button
            type="button"
            onClick={onArchive}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600"
          >
            {t('jot.archive')}
          </button>
          <button
            type="button"
            onClick={onInsert}
            disabled={inserted}
            className={`rounded px-2 py-1 text-xs font-medium ${
              inserted
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            {inserted ? t('jot.inserted') : t('jot.insertHere')}
          </button>
        </span>
      </div>
      {expanded && <NotePlacementList entries={entries} />}
      {splitting && (
        <SplitPreview
          segments={segments}
          labels={{
            title: t('jot.splitHint'),
            confirm: t('jot.splitConfirm', { n: segments.length }),
            cancel: t('jot.cancel'),
            usedWarning:
              usedCount > 0 ? t('jot.splitUsedWarning', { n: usedCount }) : undefined,
          }}
          onConfirm={() => void onSplit(segments)}
          onCancel={() => setSplitting(false)}
        />
      )}
    </li>
  )
}

/** Compact relative time; falls back to the date once it stops being "recent". */
function timeAgo(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(then).toLocaleDateString()
}
