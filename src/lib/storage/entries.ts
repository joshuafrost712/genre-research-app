/**
 * Entry persistence and React hooks. An Entry is the atomic, queryable answer
 * unit. The worksheet node's effective `layer` decides which container the entry
 * attaches to (genre / focusText / worksheet); that is recorded as exactly one of
 * genre_id / focus_text_id / worksheet_id so export and the future Robar matching
 * can read answers per layer.
 *
 * Cell addressing:
 *  - scalar block:        cell_key undefined
 *  - repeatable list item: cell_key = rowId
 *  - table / grid cell:    cell_key = rowId__colId
 *  - row order for a table/list is stored on a sidecar entry, cell_key = ROWS_KEY
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { getContentVersion } from '../content/loader'
import { now, uid } from '../util'
import { trackDelete, trackUpsert } from '../sync/outbox'
import type { ActiveContext } from './appState'
import type { Entry, RoutingStatus } from '../types'
import type { Layer } from '../../schema/types'

function parseIdArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

const ROWS_KEY = '__rows'

type ContainerPatch = Pick<Entry, 'genre_id' | 'focus_text_id' | 'worksheet_id'>

function containerPatch(layer: Layer, ctx: ActiveContext): ContainerPatch {
  switch (layer) {
    case 'genre':
      return { genre_id: ctx.genreId }
    case 'focusText':
      return { focus_text_id: ctx.focusTextId }
    case 'synthesis':
      return { worksheet_id: ctx.worksheetId }
  }
}

function containerId(layer: Layer, ctx: ActiveContext): string {
  return layer === 'genre'
    ? ctx.genreId
    : layer === 'focusText'
      ? ctx.focusTextId
      : ctx.worksheetId
}

function matchesContainer(entry: Entry, layer: Layer, ctx: ActiveContext): boolean {
  switch (layer) {
    case 'genre':
      return entry.genre_id === ctx.genreId
    case 'focusText':
      return entry.focus_text_id === ctx.focusTextId
    case 'synthesis':
      return entry.worksheet_id === ctx.worksheetId
  }
}

/** Load one entry for (node, container, cell). */
export async function findEntry(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  cellKey?: string,
): Promise<Entry | undefined> {
  const rows = await db.entries.where('node_id').equals(nodeId).toArray()
  return rows.find(
    (e) =>
      e.project_id === ctx.projectId &&
      matchesContainer(e, layer, ctx) &&
      (e.cell_key ?? undefined) === (cellKey ?? undefined),
  )
}

export interface EntryPatch {
  text?: string
  value?: string
  is_priority?: boolean
  is_not_applicable?: boolean
  is_asked?: boolean
  is_concern_flag?: boolean
  routing_status?: RoutingStatus
  captured_note_id?: string
  ai_confidence?: number
  proposed_text?: string
  proposed_note_id?: string
}

/** Create or update the entry for (node, container, cell). */
export async function upsertEntry(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  patch: EntryPatch,
  cellKey?: string,
): Promise<Entry> {
  const existing = await findEntry(ctx, nodeId, layer, cellKey)
  if (existing) {
    const updated: Entry = { ...existing, ...patch, updated_at: now(), sync_status: 'local' }
    await db.entries.put(updated)
    await trackUpsert('entries', updated)
    return updated
  }
  const created: Entry = {
    id: uid(),
    project_id: ctx.projectId,
    node_id: nodeId,
    ...containerPatch(layer, ctx),
    cell_key: cellKey,
    text: patch.text ?? '',
    value: patch.value,
    is_priority: patch.is_priority,
    is_not_applicable: patch.is_not_applicable,
    is_asked: patch.is_asked,
    is_concern_flag: patch.is_concern_flag,
    captured_note_id: patch.captured_note_id,
    ai_confidence: patch.ai_confidence,
    proposed_text: patch.proposed_text,
    proposed_note_id: patch.proposed_note_id,
    routing_status: patch.routing_status ?? 'confirmed',
    schema_version: getContentVersion(),
    sync_status: 'local',
    created_at: now(),
    updated_at: now(),
  }
  await db.entries.put(created)
  await trackUpsert('entries', created)
  return created
}

export async function deleteEntry(id: string): Promise<void> {
  const existing = await db.entries.get(id)
  await db.entries.delete(id)
  if (existing) await trackDelete('entries', id, existing.project_id)
}

/** Reactive read of a single entry. */
export function useEntry(ctx: ActiveContext | null, nodeId: string, layer: Layer, cellKey?: string) {
  return useLiveQuery(
    async () => (ctx ? ((await findEntry(ctx, nodeId, layer, cellKey)) ?? null) : null),
    [ctx?.projectId, containerKeyDep(ctx, layer), nodeId, cellKey],
  )
}

function containerKeyDep(ctx: ActiveContext | null, layer: Layer): string {
  return ctx ? containerId(layer, ctx) : ''
}

// --- repeatable rows (lists and tables) -----------------------------------

/** Ordered row ids for a repeatable list/table node, persisted on a sidecar entry. */
export async function getRowIds(ctx: ActiveContext, nodeId: string, layer: Layer): Promise<string[]> {
  const sidecar = await findEntry(ctx, nodeId, layer, ROWS_KEY)
  if (!sidecar?.value) return []
  try {
    const parsed = JSON.parse(sidecar.value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

async function setRowIds(ctx: ActiveContext, nodeId: string, layer: Layer, ids: string[]): Promise<void> {
  await upsertEntry(ctx, nodeId, layer, { value: JSON.stringify(ids) }, ROWS_KEY)
}

export async function addRow(ctx: ActiveContext, nodeId: string, layer: Layer): Promise<string> {
  const ids = await getRowIds(ctx, nodeId, layer)
  const rowId = uid()
  await setRowIds(ctx, nodeId, layer, [...ids, rowId])
  return rowId
}

export async function removeRow(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  rowId: string,
): Promise<void> {
  const ids = await getRowIds(ctx, nodeId, layer)
  await setRowIds(ctx, nodeId, layer, ids.filter((id) => id !== rowId))
  // Drop the row's cell entries (the row id is the prefix before "__").
  const rows = await db.entries.where('node_id').equals(nodeId).toArray()
  const orphans = rows.filter(
    (e) =>
      e.project_id === ctx.projectId &&
      matchesContainer(e, layer, ctx) &&
      e.cell_key != null &&
      (e.cell_key === rowId || e.cell_key.startsWith(`${rowId}__`)),
  )
  await db.entries.bulkDelete(orphans.map((e) => e.id))
  for (const e of orphans) await trackDelete('entries', e.id, e.project_id)
}

/** Reactive read of a node's row ids. */
export function useRowIds(ctx: ActiveContext | null, nodeId: string, layer: Layer) {
  return useLiveQuery(
    async () => (ctx ? await getRowIds(ctx, nodeId, layer) : []),
    [ctx?.projectId, containerKeyDep(ctx, layer), nodeId],
  )
}

// --- flags (priority, not-applicable) -------------------------------------

/**
 * Toggle a block-level flag (not-applicable on a scalar block). Stored on the
 * block's own entry (cell_key undefined). Marking not-applicable makes "ignore
 * what is irrelevant" a recorded decision rather than a silent blank.
 */
export async function setBlockNotApplicable(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  value: boolean,
): Promise<void> {
  await upsertEntry(ctx, nodeId, layer, { is_not_applicable: value })
}

/**
 * Toggle a row-level priority flag for a repeatable table/list row, stored on the
 * row-level entry (cell_key = rowId). Table cells live at rowId__colId, so the
 * rowId entry is free to carry row flags.
 */
export async function setRowPriority(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  rowId: string,
  value: boolean,
): Promise<void> {
  await upsertEntry(ctx, nodeId, layer, { is_priority: value }, rowId)
}

/**
 * Toggle a row-level "asked" flag for a repeatable_list item (cell_key = rowId).
 * Lets a researcher mark an idea of whom/where/what to ask as already done.
 */
export async function setRowAsked(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  rowId: string,
  value: boolean,
): Promise<void> {
  await upsertEntry(ctx, nodeId, layer, { is_asked: value }, rowId)
}

/**
 * Toggle a block-level "follow up / want more info" flag on a scalar block
 * (cell_key undefined), reusing the existing `is_concern_flag` field. Flagged
 * blocks gather on the /follow-up page so a researcher can revisit them (e.g.
 * when they finally meet a local expert) without hunting through the worksheet.
 */
export async function setBlockFollowUp(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  value: boolean,
): Promise<void> {
  await upsertEntry(ctx, nodeId, layer, { is_concern_flag: value })
}

/** Row-level variant of the follow-up flag (cell_key = rowId). */
export async function setRowFollowUp(
  ctx: ActiveContext,
  nodeId: string,
  layer: Layer,
  rowId: string,
  value: boolean,
): Promise<void> {
  await upsertEntry(ctx, nodeId, layer, { is_concern_flag: value }, rowId)
}

/** All entries for the active project (for progress and export). */
export function useAllEntries(ctx: ActiveContext | null): Entry[] | undefined {
  return useLiveQuery(
    async () => (ctx ? await db.entries.where('project_id').equals(ctx.projectId).toArray() : []),
    [ctx?.projectId],
  )
}

/** Container id an entry belongs to for a given layer (for filtering in JS). */
export function entryContainerId(layer: Layer, ctx: ActiveContext): string {
  return containerId(layer, ctx)
}

// --- AI-proposed (needs_review) entries -----------------------------------

/**
 * Live list of entries awaiting a human decision. Two kinds:
 *  - fresh proposals: `routing_status === 'needs_review'` (AI placed into an
 *    empty/unconfirmed cell)
 *  - conflicts: a confirmed answer that AI wants to change, held in
 *    `proposed_text` so it never silently overwrites the existing answer
 */
export function useNeedsReview(ctx: ActiveContext | null): Entry[] | undefined {
  return useLiveQuery(async () => {
    if (!ctx) return []
    const rows = await db.entries.where('project_id').equals(ctx.projectId).toArray()
    return rows
      .filter((e) => e.routing_status === 'needs_review' || (e.proposed_text?.trim() ?? '') !== '')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [ctx?.projectId])
}

/** True when an entry holds an AI suggestion that conflicts with a kept answer. */
export function isConflict(entry: Entry): boolean {
  return entry.routing_status === 'confirmed' && (entry.proposed_text?.trim() ?? '') !== ''
}

/**
 * Resolve an AI conflict on an already-confirmed scalar answer. `keep` drops the
 * AI suggestion and leaves the answer untouched; `replace` swaps in the AI text;
 * `append` joins both. In every case the proposal fields are cleared so the item
 * leaves the review queue.
 */
export async function resolveConflict(
  entry: Entry,
  action: 'keep' | 'replace' | 'append',
): Promise<void> {
  const proposed = entry.proposed_text ?? ''
  const text =
    action === 'replace'
      ? proposed
      : action === 'append'
        ? `${entry.text.trim()}\n${proposed.trim()}`.trim()
        : entry.text
  const patch: Partial<Entry> = {
    text,
    proposed_text: undefined,
    proposed_note_id: undefined,
    updated_at: now(),
  }
  // Taking the AI text makes it AI-sourced; keeping mine drops the AI mark.
  if (action === 'keep') patch.ai_confidence = undefined
  else if (entry.proposed_note_id) patch.captured_note_id = entry.proposed_note_id
  await db.entries.update(entry.id, patch)
  const updated = await db.entries.get(entry.id)
  if (updated) await trackUpsert('entries', updated)
}

/** Accept a proposal: optionally edit the text, then mark it confirmed. */
export async function confirmEntry(id: string, text?: string): Promise<void> {
  const patch: Partial<Entry> = { routing_status: 'confirmed', updated_at: now() }
  if (text !== undefined) patch.text = text
  await db.entries.update(id, patch)
  const updated = await db.entries.get(id)
  if (updated) await trackUpsert('entries', updated)
}

/**
 * Discard a proposal. For a table/list row this removes the whole row (its cells
 * plus the row id in the sidecar); for a scalar it deletes the entry. Operates on
 * the entry's own container, so it is correct regardless of the active context.
 */
export async function discardProposal(entry: Entry): Promise<void> {
  if (!entry.cell_key || entry.cell_key === ROWS_KEY) {
    await db.entries.delete(entry.id)
    await trackDelete('entries', entry.id, entry.project_id)
    return
  }
  const rowId = entry.cell_key.split('__')[0]
  const cid = entry.genre_id ?? entry.focus_text_id ?? entry.worksheet_id ?? ''
  const siblings = await db.entries.where('node_id').equals(entry.node_id).toArray()
  const inContainer = (e: Entry) =>
    (e.genre_id ?? e.focus_text_id ?? e.worksheet_id ?? '') === cid
  const rowCells = siblings.filter(
    (e) => inContainer(e) && e.cell_key && (e.cell_key === rowId || e.cell_key.startsWith(`${rowId}__`)),
  )
  await db.entries.bulkDelete(rowCells.map((e) => e.id))
  for (const e of rowCells) await trackDelete('entries', e.id, e.project_id)
  const sidecar = siblings.find((e) => inContainer(e) && e.cell_key === ROWS_KEY)
  if (sidecar) {
    const remaining = parseIdArray(sidecar.value).filter((id) => id !== rowId)
    await db.entries.update(sidecar.id, { value: JSON.stringify(remaining) })
    const updated = await db.entries.get(sidecar.id)
    if (updated) await trackUpsert('entries', updated)
  }
}

export { ROWS_KEY }
