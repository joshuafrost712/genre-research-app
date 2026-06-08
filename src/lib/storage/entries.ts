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
import type { ActiveContext } from './appState'
import type { Entry, RoutingStatus } from '../types'
import type { Layer } from '../../schema/types'

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
  is_concern_flag?: boolean
  routing_status?: RoutingStatus
  captured_note_id?: string
  ai_confidence?: number
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
    is_concern_flag: patch.is_concern_flag,
    captured_note_id: patch.captured_note_id,
    ai_confidence: patch.ai_confidence,
    routing_status: patch.routing_status ?? 'confirmed',
    schema_version: getContentVersion(),
    sync_status: 'local',
    created_at: now(),
    updated_at: now(),
  }
  await db.entries.put(created)
  return created
}

export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id)
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
}

/** Reactive read of a node's row ids. */
export function useRowIds(ctx: ActiveContext | null, nodeId: string, layer: Layer) {
  return useLiveQuery(
    async () => (ctx ? await getRowIds(ctx, nodeId, layer) : []),
    [ctx?.projectId, containerKeyDep(ctx, layer), nodeId],
  )
}
