/**
 * Persisted entity records. Layered model from the canonical plan:
 * genre analysis is reusable across focus texts; the focus text describes the
 * psalm; the worksheet is the focus-text-and-genre synthesis. A CapturedNote is
 * the immutable raw dictation; Entries are the structured, reviewable units
 * derived from it (one note can fan out to several Entries across layers).
 */

export type SyncStatus = 'local' | 'queued' | 'synced' | 'error'
export type ScopeSetting = 'narrow' | 'narrower' | 'broad'
export type RoutingStatus = 'auto' | 'needs_review' | 'confirmed'

export interface Project {
  id: string
  name: string
  languages: string[]
  team_members: string[]
  scope: ScopeSetting
  config_version: string
  is_sensitive: boolean
  created_at: string
  updated_at: string
}

export interface FocusText {
  id: string
  project_id: string
  reference: string
  specific_purpose?: string
  general_purpose?: string
  broad_genre?: string
  intended_use?: string
  created_at: string
  // Optional on legacy rows; used by sync as the LWW timestamp when present.
  updated_at?: string
}

export interface Genre {
  id: string
  project_id: string
  name: string
  name_meaning?: string
  vitality_rating?: 'weak' | 'neutral' | 'strong'
  is_sensitive: boolean
  created_at: string
  updated_at: string
}

export interface TranslationWorksheet {
  id: string
  project_id: string
  focus_text_id: string
  genre_id: string
  status: 'draft' | 'in_progress' | 'complete'
  final_translation_draft?: string
  created_at: string
  updated_at: string
}

/** Immutable provenance record: raw dictation exactly as captured. */
export interface CapturedNote {
  id: string
  project_id: string
  raw_text: string
  source_language?: string
  created_at: string
}

/**
 * The atomic, queryable, exportable answer unit. `node_id` is the worksheet node;
 * the node's `layer` decides which container the entry belongs to, recorded here as
 * exactly one of genre_id / focus_text_id / worksheet_id.
 */
export interface Entry {
  id: string
  project_id: string
  node_id: string
  captured_note_id?: string
  genre_id?: string
  focus_text_id?: string
  worksheet_id?: string
  // Cell address for table/grid answers (rowId for rows, rowId__colId for grid cells).
  cell_key?: string
  text: string
  value?: string // for select/scale answers
  routing_status: RoutingStatus
  ai_confidence?: number
  is_concern_flag?: boolean
  is_priority?: boolean
  is_not_applicable?: boolean
  schema_version: string
  sync_status: SyncStatus
  created_at: string
  updated_at: string
}

export interface Person {
  id: string
  project_id: string
  name: string
  role?: string
  pseudonym?: string
  is_sensitive: boolean
}

/** Small key/value store for app state: active project, resume cursors, etc. */
export interface MetaRecord {
  key: string
  value: string
}
