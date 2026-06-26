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

export async function createCapturedNote(
  ctx: ActiveContext,
  rawText: string,
  sourceLanguage?: string,
): Promise<CapturedNote> {
  const note: CapturedNote = {
    id: uid(),
    project_id: ctx.projectId,
    raw_text: rawText,
    source_language: sourceLanguage,
    created_at: now(),
  }
  await db.capturedNotes.put(note)
  await trackUpsert('capturedNotes', note) // insert-once; merge treats notes as immutable
  return note
}

export function useNotes(ctx: ActiveContext | null): CapturedNote[] | undefined {
  return useLiveQuery(async () => {
    if (!ctx) return []
    const rows = await db.capturedNotes.where('project_id').equals(ctx.projectId).toArray()
    return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [ctx?.projectId])
}

/** Entries derived from a given note (for showing where a note went). */
export function useEntriesForNote(ctx: ActiveContext | null, noteId: string) {
  return useLiveQuery(
    async () =>
      ctx ? await db.entries.where('captured_note_id').equals(noteId).toArray() : [],
    [ctx?.projectId, noteId],
  )
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
): Promise<void> {
  const layer = effectiveLayer(node.id)
  if (!layer) return

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
    return
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
    return
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
  }
}
