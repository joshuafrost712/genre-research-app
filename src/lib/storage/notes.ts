/**
 * Captured notes and manual routing. A CapturedNote is the immutable record of a
 * dictated observation (provenance). Routing derives structured Entries from it:
 * one note can land on several worksheet nodes (the "funnel to multiple layers"
 * behaviour). For the MVP routing is manual; the AI proposes routing later.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { addRow, findEntry, upsertEntry } from './entries'
import { effectiveLayer } from '../content/loader'
import { trackUpsert } from '../sync/outbox'
import { now, uid } from '../util'
import type { ActiveContext } from './appState'
import type { CapturedNote } from '../types'
import type { GuideNode } from '../../schema/types'

/** Who captured a note. Computed by the caller from the Supabase session. */
export interface NoteAuthor {
  id: string
  label: string
}

/**
 * Derive the author stamp from a session user. Kept here (pure, no React) so
 * QuickJot and Capture stamp identically. Guests/offline return undefined and
 * the note simply carries no author.
 */
export function noteAuthorOf(
  user: { id: string; email: string; name?: string } | null | undefined,
): NoteAuthor | undefined {
  if (!user) return undefined
  return { id: user.id, label: user.name?.trim() || user.email }
}

export async function createCapturedNote(
  ctx: ActiveContext,
  rawText: string,
  sourceLanguage?: string,
  author?: NoteAuthor,
): Promise<CapturedNote> {
  const note: CapturedNote = {
    id: uid(),
    project_id: ctx.projectId,
    raw_text: rawText,
    source_language: sourceLanguage,
    created_at: now(),
    author_id: author?.id,
    author_label: author?.label,
  }
  await db.capturedNotes.put(note)
  await trackUpsert('capturedNotes', note) // insert-once; merge treats notes as immutable
  return note
}

/**
 * A stamp guaranteed to sort after `prev`, even when the wall clock says
 * otherwise. The client merge rule is presence-based, but the SERVER's
 * push_records still does tuple LWW on the envelope's updated_at — and a plain
 * jot's envelope carries its created_at from the CAPTURER's clock. If that
 * clock runs minutes fast (workshop condition, see pull.ts), a bare now() from
 * a correct clock compares lower, the server skips the DO UPDATE, and the
 * archive silently never replicates. Bumping past the row's own stamp makes
 * archive/restore monotone regardless of whose clock is wrong.
 */
function stampAfter(prev: string | undefined): string {
  const current = now()
  if (!prev) return current
  const parsed = Date.parse(prev)
  if (Number.isNaN(parsed)) return current
  const bumped = new Date(parsed + 1).toISOString()
  return bumped > current ? bumped : current
}

/**
 * Archive ("delete" in the UI). The note disappears from pickers and the recent
 * list but the record stays: entries routed from it keep their provenance, and
 * the merge rule can never resurrect it from an old client's replay. Stamping
 * `updated_at` is what gives the row archive/restore precedence in the merge —
 * see the presence-based rule in sync/merge.ts.
 */
export async function dismissCapturedNote(note: CapturedNote): Promise<CapturedNote> {
  const stamp = stampAfter(note.updated_at ?? note.created_at)
  await db.capturedNotes.update(note.id, { dismissed_at: stamp, updated_at: stamp })
  const updated = (await db.capturedNotes.get(note.id)) ?? { ...note, dismissed_at: stamp, updated_at: stamp }
  await trackUpsert('capturedNotes', updated)
  return updated
}

/** Undo an archive. Keeps `updated_at`, so a later archive elsewhere still wins. */
export async function restoreCapturedNote(note: CapturedNote): Promise<CapturedNote> {
  // Dexie deletes a key set to undefined in update(), which is exactly what we
  // want: a restored row carries no dismissed_at at all. The monotone stamp
  // matters here too: a restore must out-sort the archive it undoes, or the
  // server rejects it the same way it rejects a skewed archive.
  await db.capturedNotes.update(note.id, {
    dismissed_at: undefined,
    updated_at: stampAfter(note.updated_at ?? note.created_at),
  })
  const updated = (await db.capturedNotes.get(note.id)) ?? note
  await trackUpsert('capturedNotes', updated)
  return updated
}

/**
 * How many fragments the single-newline fallback may produce. Wispr breaks
 * lines at speech pauses, not paragraphs, and a 30-fragment split has no bulk
 * undo (recovery is restore-the-original plus N individual archives). Blank
 * lines are deliberate, so the blank-line path is uncapped.
 */
const SPLIT_FALLBACK_MAX = 8

/**
 * Cut a jot's text into candidate segments for splitting. Blank lines win; a
 * text without them falls back to single newlines (dictation rarely produces
 * true paragraph breaks). Returns [] when the text isn't splittable — fewer
 * than 2 segments either way, or a fallback that would shatter into more than
 * SPLIT_FALLBACK_MAX pieces. Pure; exported for tests.
 */
export function splitSegments(rawText: string): string[] {
  const clean = (parts: string[]) => parts.map((p) => p.trim()).filter(Boolean)
  const byBlank = clean(rawText.split(/\n\s*\n/))
  if (byBlank.length >= 2) return byBlank
  const byLine = clean(rawText.split('\n'))
  if (byLine.length >= 2 && byLine.length <= SPLIT_FALLBACK_MAX) return byLine
  return []
}

/**
 * Split one jot into several. NOT a new mutation kind: each segment is a fresh
 * insert-once row (the safest shape in the merge — every client, old or new,
 * takes it as a plain insert) and the original is archived through the
 * sanctioned path, provenance intact. Returns the new notes, [] if there was
 * nothing to split (in which case nothing was written).
 */
export async function splitCapturedNote(
  ctx: ActiveContext,
  note: CapturedNote,
  segments: string[],
): Promise<CapturedNote[]> {
  if (segments.length < 2) return [] // never archive the original with no replacement

  // Stamp from the ORIGINAL's created_at (it is provenance — now() would claim
  // the fragments were dictated at split time and teleport them to the top of
  // the list). Reversed offsets so the newest-first list shows the segments in
  // paragraph order, sitting just above the original's old position.
  const base = Date.parse(note.created_at)
  const n = segments.length
  const created: CapturedNote[] = []
  for (let i = 0; i < n; i++) {
    const segment: CapturedNote = {
      id: uid(),
      project_id: ctx.projectId,
      raw_text: segments[i],
      source_language: note.source_language,
      created_at: Number.isNaN(base)
        ? now()
        : new Date(base + (n - i)).toISOString(),
      author_id: note.author_id,
      author_label: note.author_label,
      split_from: note.id,
    }
    await db.capturedNotes.put(segment)
    await trackUpsert('capturedNotes', segment) // insert-once, same as create
    created.push(segment)
  }
  await dismissCapturedNote(note)
  return created
}

export function useNotes(ctx: ActiveContext | null): CapturedNote[] | undefined {
  return useLiveQuery(async () => {
    if (!ctx) return []
    const rows = await db.capturedNotes.where('project_id').equals(ctx.projectId).toArray()
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [ctx?.projectId])
}

/** Notes the pickers should offer: everything not archived, newest first. */
export function useActiveNotes(ctx: ActiveContext | null): CapturedNote[] | undefined {
  const notes = useNotes(ctx)
  return notes?.filter((n) => !n.dismissed_at)
}

/** Entries derived from a given note (for showing where a note went). */
export function useEntriesForNote(ctx: ActiveContext | null, noteId: string) {
  return useLiveQuery(
    async () =>
      ctx ? await db.entries.where('captured_note_id').equals(noteId).toArray() : [],
    [ctx?.projectId, noteId],
  )
}

/** What routing produced, so a caller can e.g. open the row the note landed in. */
export interface RoutePlacement {
  /** Set when the note landed as a new list/table row. */
  rowId?: string
}

/**
 * Route a note onto a target node. Behaviour by node type:
 *  - scalar text: append to (or set) the block's answer
 *  - repeatable list: add the note as a new list item
 *  - repeatable-row table: add a row and place the text in its first text column
 * Always records captured_note_id as provenance and confirms the routing (manual).
 */
export async function routeNoteToNode(
  ctx: ActiveContext,
  note: CapturedNote,
  node: GuideNode,
): Promise<RoutePlacement | undefined> {
  const layer = effectiveLayer(node.id)
  if (!layer) return undefined

  if (node.type === 'short_text' || node.type === 'long_text') {
    const existing = await findEntry(ctx, node.id, layer)
    const text = existing?.text?.trim()
      ? `${existing.text.trim()}\n${note.raw_text}`
      : note.raw_text
    await upsertEntry(ctx, node.id, layer, {
      text,
      captured_note_id: note.id,
      routing_status: 'confirmed',
    })
    return {}
  }

  if (node.type === 'repeatable_list') {
    const rowId = await addRow(ctx, node.id, layer)
    await upsertEntry(
      ctx,
      node.id,
      layer,
      { text: note.raw_text, captured_note_id: note.id, routing_status: 'confirmed' },
      rowId,
    )
    return { rowId }
  }

  if (node.type === 'repeatable_row_table') {
    const firstText = (node.columns ?? []).find(
      (c) => c.cellType === 'short_text' || c.cellType === 'long_text',
    )
    const rowId = await addRow(ctx, node.id, layer)
    if (firstText) {
      await upsertEntry(
        ctx,
        node.id,
        layer,
        { text: note.raw_text, captured_note_id: note.id, routing_status: 'confirmed' },
        `${rowId}__${firstText.id}`,
      )
    }
    return { rowId }
  }

  return undefined
}
