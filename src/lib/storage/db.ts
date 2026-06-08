import Dexie, { type EntityTable } from 'dexie'
import type {
  CapturedNote,
  Entry,
  FocusText,
  Genre,
  MetaRecord,
  Person,
  Project,
  TranslationWorksheet,
} from '../types'

/**
 * On-device store (IndexedDB via Dexie). Source of truth for the MVP: project
 * data stays local and exports to Sheets/CSV. The `entries` and `capturedNotes`
 * stores carry sync_status so an outbox to Supabase can be added later without a
 * schema migration (mirrors cairn's outbox pattern).
 */
class GenreResearchDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  focusTexts!: EntityTable<FocusText, 'id'>
  genres!: EntityTable<Genre, 'id'>
  worksheets!: EntityTable<TranslationWorksheet, 'id'>
  capturedNotes!: EntityTable<CapturedNote, 'id'>
  entries!: EntityTable<Entry, 'id'>
  persons!: EntityTable<Person, 'id'>
  meta!: EntityTable<MetaRecord, 'key'>

  constructor() {
    super('genre-research')
    this.version(1).stores({
      projects: 'id, updated_at',
      focusTexts: 'id, project_id',
      genres: 'id, project_id, name',
      worksheets: 'id, project_id, focus_text_id, genre_id, status',
      capturedNotes: 'id, project_id, created_at',
      // queried by the node it answers, by container, by routing/review state
      entries:
        'id, project_id, node_id, captured_note_id, genre_id, focus_text_id, worksheet_id, routing_status, sync_status, updated_at',
      persons: 'id, project_id',
      meta: 'key',
    })
  }
}

export const db = new GenreResearchDB()

/** Entries still needing to reach a backend once sync exists — the future outbox. */
export function getOutbox() {
  return db.entries.where('sync_status').anyOf('local', 'queued', 'error').toArray()
}

/** Grid/table cell address helper, kept consistent across capture and export. */
export const cellKey = (rowId: string, colId?: string) =>
  colId ? `${rowId}__${colId}` : rowId
