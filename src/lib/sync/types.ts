/**
 * Shared shapes for the cloud-sync layer. The sync unit is a per-author shard
 * file: each device writes only its own shard (a cumulative snapshot of records
 * that author has touched, keyed by `table/recordId`), and every client merges
 * all shards by record id with last-write-wins on `updated_at`.
 */

export type SyncTable =
  | 'projects'
  | 'focusTexts'
  | 'genres'
  | 'worksheets'
  | 'capturedNotes'
  | 'entries'

export const SYNC_TABLES: SyncTable[] = [
  'projects',
  'focusTexts',
  'genres',
  'worksheets',
  'capturedNotes',
  'entries',
]

export type SyncOp = 'upsert' | 'delete'

/** One pending local change, awaiting a flush to the cloud shard. */
export interface OutboxRow {
  seq?: number
  table: SyncTable
  recordId: string
  /** The owning project id, used to route the op to the right scope's folder. */
  project_id: string
  op: SyncOp
  updated_at: string
  data?: unknown
}

export interface ShardRecord {
  table: SyncTable
  op: SyncOp
  updated_at: string
  data?: unknown
}

export interface Shard {
  schemaVersion: string
  authorId: string
  authorEmail?: string
  updatedAt: string
  records: Record<string, ShardRecord>
}

export const SHARD_SCHEMA_VERSION = '1'