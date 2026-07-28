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
  // Structured Bible reference (added v5) so passages sort in canonical order
  // and are searchable by book. Best-effort: parsed from `reference` on
  // create/rename and backfilled for legacy rows; `reference` stays the source
  // of truth for display. Unparseable references leave these undefined.
  book?: string
  chapter?: number
  verse_start?: number
  verse_end?: number
  // 'active' (the working set) or 'completed' (retired to the completed folder).
  // Absent on legacy rows is treated as 'active'.
  status?: 'active' | 'completed'
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
  vitality_rating?: 'extinct' | 'locked' | 'fading' | 'stable' | 'thriving'
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
  /**
   * The language `text` was entered in. Mirrors CapturedNote.source_language.
   * Absent on entries written before multi-language support; treat as English.
   */
  source_language?: string
  /**
   * Translations of `text`, keyed by locale. A cache, never the record of what
   * the team said: `text` stays authoritative, and this is CLEARED whenever
   * `text` or `value` changes (see upsertEntry) so a stale translation can never
   * outlive the answer it was made from.
   *
   * Unindexed, so no Dexie version bump is needed, and the shard sync carries it
   * automatically because it merges whole records.
   */
  translations?: Record<string, string>
  routing_status: RoutingStatus
  ai_confidence?: number
  // AI proposed a different answer for a cell that already holds a confirmed one.
  // Held here (not in `text`) so the AI suggestion never silently overwrites the
  // existing answer; surfaced in Review for the team to keep / replace / append.
  proposed_text?: string
  proposed_note_id?: string
  is_concern_flag?: boolean
  is_not_applicable?: boolean
  is_asked?: boolean // ask-tracking: the researcher has asked this person/at this place/this question
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

/**
 * One prior value of an Entry, written whenever a click-through edit changes
 * shared genre data from the Create / Translate workspace (and cheap enough to
 * write on any edit path that opts in). Lets a team recover lost information.
 */
export interface HistoryRow {
  seq?: number // auto-increment
  entry_id: string
  project_id: string
  node_id: string
  cell_key?: string
  prev_text?: string
  prev_value?: string
  changed_at: string
  /** Where the edit came from (e.g. 'compare-edit' for the 2c/2d click-through). */
  source?: string
}

/** A voice recording (first-draft take) attached to a translation worksheet. */
export interface Recording {
  id: string
  project_id: string
  worksheet_id: string
  node_id: string
  mime_type: string
  blob: Blob
  duration_sec?: number
  label?: string
  created_at: string
}
