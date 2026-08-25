// High-level routing operations. Ties the device store (Dexie) to the routing
// workspace shapes, the routing contract, and the GitHub client. Two paths, same
// file shapes:
//
//   Automated (a GitHub token is set): pushPendingNotes() writes inbox/<id>.json
//     (+ ROUTING.md and reference/*); you route on the repo with Claude Max;
//     pullPlacements() reads outbox/<id>.json.
//   Manual (no token, fully phone-native): buildExportBundle() gives text you paste
//     into Claude; importPlacementsText() ingests Claude's JSON reply. No creds.
//
// Imported placements become needs_review entries for the team to confirm.

import { db, cellKey } from '../lib/storage/db'
import { effectiveLayer, findNode, routableNodes } from '../lib/content/loader'
import { addRow, findEntry, upsertEntry } from '../lib/storage/entries'
import { validatePlacement, type RoutedPlacement } from '../ai/contract'
import {
  buildNoteFile,
  inboxPath,
  renderNodesJson,
  renderRoutingDoc,
  renderSchemaJson,
  type NoteFile,
  type PlacementsFile,
  type RoutableNodeRef,
} from '../ai/workspace'
import { canPushPull } from './config'
import { getFile, listDir, putFile } from './github'
import type { ActiveContext } from '../lib/storage/appState'
import type { CapturedNote } from '../lib/types'

const CONFIDENCE_SCORE: Record<RoutedPlacement['confidence'], number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.9,
}

function routableNodeRefs(): RoutableNodeRef[] {
  return routableNodes().map((r) => ({
    id: r.node.id,
    section: r.sectionLabel,
    subsection: r.subLabel,
    label: r.node.label,
    type: r.node.type,
  }))
}

function validNodeIds(): Set<string> {
  return new Set(routableNodeRefs().map((n) => n.id))
}

/** Captured notes that have not yet produced any entries (nothing routed from them). */
export async function listPendingNotes(ctx: ActiveContext): Promise<CapturedNote[]> {
  const [notes, entries] = await Promise.all([
    db.capturedNotes.where('project_id').equals(ctx.projectId).toArray(),
    db.entries.where('project_id').equals(ctx.projectId).toArray(),
  ])
  const routed = new Set(entries.map((e) => e.captured_note_id).filter(Boolean) as string[])
  return notes
    .filter((n) => !routed.has(n.id) && !n.dismissed_at && n.raw_text.trim())
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

async function noteFileFor(note: CapturedNote, ctx: ActiveContext, nodes: RoutableNodeRef[]): Promise<NoteFile> {
  const [focusText, genre] = await Promise.all([
    db.focusTexts.get(ctx.focusTextId),
    db.genres.get(ctx.genreId),
  ])
  return buildNoteFile({
    note_id: note.id,
    source_text: note.raw_text,
    source_language: note.source_language ?? null,
    focus_text: focusText?.reference ?? '—',
    genre: genre?.name ?? '—',
    routable_nodes: nodes,
    created_at: note.created_at,
  })
}

// ---- automated path (GitHub token set) -----------------------------------

export async function pushPendingNotes(ctx: ActiveContext): Promise<{ pushed: number }> {
  const nodes = routableNodeRefs()
  // Keep the repo self-bootstrapping: runbook + reference always current.
  await putFile('routing/ROUTING.md', renderRoutingDoc(), 'update routing runbook')
  await putFile('routing/reference/schema.json', renderSchemaJson(), 'update output schema')
  await putFile('routing/reference/nodes.json', renderNodesJson(nodes), 'update routable nodes')

  const pending = await listPendingNotes(ctx)
  let pushed = 0
  for (const note of pending) {
    const file = await noteFileFor(note, ctx, nodes)
    await putFile(inboxPath(note.id), JSON.stringify(file, null, 2) + '\n', `note ${note.id}`)
    pushed++
  }
  return { pushed }
}

export async function pullPlacements(ctx: ActiveContext): Promise<IngestResult> {
  const entries = await listDir('routing/outbox')
  const total: IngestResult = { files: 0, stored: 0, rejected: 0, conflicts: 0 }
  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
    const got = await getFile(entry.path)
    if (!got) continue
    const r = await ingestText(got.text, ctx)
    total.files += r.files
    total.stored += r.stored
    total.rejected += r.rejected
    total.conflicts += r.conflicts
  }
  return total
}

export function automatedAvailable(): boolean {
  return canPushPull()
}

// ---- manual path (no token) ----------------------------------------------

/** A single self-contained text blob to paste into Claude (runbook + schema + notes). */
export async function buildExportBundle(ctx: ActiveContext): Promise<{ text: string; count: number }> {
  const nodes = routableNodeRefs()
  const pending = await listPendingNotes(ctx)
  const files = await Promise.all(pending.map((n) => noteFileFor(n, ctx, nodes)))
  const text = [
    renderRoutingDoc(),
    '## Output schema (reference/schema.json)',
    '```json',
    renderSchemaJson().trim(),
    '```',
    '## Notes to route',
    '```json',
    JSON.stringify(files, null, 2),
    '```',
    'Reply with a JSON array of placement files, one per note: {schema, note_id, routed_at, placements}.',
  ].join('\n\n')
  return { text, count: files.length }
}

export async function importPlacementsText(text: string, ctx: ActiveContext): Promise<IngestResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That is not valid JSON.')
  }
  const result = await ingestParsed(parsed, ctx)
  if (result.files === 0) throw new Error('No placement results found in that JSON.')
  return result
}

// ---- shared ingest --------------------------------------------------------

export interface IngestResult {
  files: number
  stored: number
  rejected: number
  conflicts: number
}

async function ingestText(text: string, ctx: ActiveContext): Promise<IngestResult> {
  try {
    return await ingestParsed(JSON.parse(text), ctx)
  } catch {
    return { files: 0, stored: 0, rejected: 0, conflicts: 0 }
  }
}

async function ingestParsed(parsed: unknown, ctx: ActiveContext): Promise<IngestResult> {
  const total: IngestResult = { files: 0, stored: 0, rejected: 0, conflicts: 0 }
  for (const file of extractPlacementsFiles(parsed)) {
    const r = await storePlacementsFile(file, ctx)
    total.files++
    total.stored += r.stored
    total.rejected += r.rejected
    total.conflicts += r.conflicts
  }
  return total
}

function extractPlacementsFiles(parsed: unknown): PlacementsFile[] {
  if (Array.isArray(parsed)) return parsed.filter(isPlacementsFile)
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.results)) return obj.results.filter(isPlacementsFile)
    if (isPlacementsFile(parsed)) return [parsed]
  }
  return []
}

function isPlacementsFile(x: unknown): x is PlacementsFile {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.note_id === 'string' && Array.isArray(o.placements)
}

async function storePlacementsFile(
  file: PlacementsFile,
  ctx: ActiveContext,
): Promise<{ stored: number; rejected: number; conflicts: number }> {
  const ids = validNodeIds()
  let stored = 0
  let rejected = 0
  let conflicts = 0
  for (const raw of file.placements) {
    const v = validatePlacement(raw, ids)
    if (!v.ok) {
      rejected++
      continue
    }
    const outcome = await applyPlacement(ctx, file.note_id, v.value)
    if (outcome === 'stored') stored++
    else if (outcome === 'conflict') conflicts++
    else rejected++
  }
  return { stored, rejected, conflicts }
}

/** Turn one validated placement into a needs_review entry. Never clobbers a
 * confirmed scalar answer (reports a conflict instead). */
async function applyPlacement(
  ctx: ActiveContext,
  noteId: string,
  p: RoutedPlacement,
): Promise<'stored' | 'conflict' | 'skipped'> {
  const ref = findNode(p.node_id)
  if (!ref) return 'skipped'
  const node = ref.node
  const layer = effectiveLayer(node.id)
  if (!layer) return 'skipped'
  const patch = {
    captured_note_id: noteId,
    routing_status: 'needs_review' as const,
    ai_confidence: CONFIDENCE_SCORE[p.confidence],
  }

  if (node.type === 'short_text' || node.type === 'long_text') {
    const existing = await findEntry(ctx, node.id, layer)
    const current = existing?.text?.trim() ?? ''
    if (current && existing?.routing_status === 'confirmed') {
      // Don't overwrite a kept answer. If the AI suggests the same thing, it's a
      // no-op; otherwise hold the suggestion in proposed_text for human review.
      if (current === p.text.trim()) return 'skipped'
      await upsertEntry(ctx, node.id, layer, {
        proposed_text: p.text,
        proposed_note_id: noteId,
        ai_confidence: CONFIDENCE_SCORE[p.confidence],
      })
      return 'conflict'
    }
    await upsertEntry(ctx, node.id, layer, { text: p.text, ...patch })
    return 'stored'
  }
  if (node.type === 'repeatable_list') {
    const rowId = await addRow(ctx, node.id, layer)
    await upsertEntry(ctx, node.id, layer, { text: p.text, ...patch }, rowId)
    return 'stored'
  }
  if (node.type === 'repeatable_row_table') {
    const firstText = (node.columns ?? []).find(
      (c) => c.cellType === 'short_text' || c.cellType === 'long_text',
    )
    const rowId = await addRow(ctx, node.id, layer)
    if (firstText) {
      await upsertEntry(ctx, node.id, layer, { text: p.text, ...patch }, cellKey(rowId, firstText.id))
      return 'stored'
    }
  }
  return 'skipped'
}
