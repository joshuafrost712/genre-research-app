import Dexie, { type EntityTable } from 'dexie'
import type {
  CapturedNote,
  Entry,
  FocusText,
  Genre,
  HistoryRow,
  MetaRecord,
  Person,
  Project,
  Recording,
  TranslationWorksheet,
} from '../types'
import type { OutboxRow } from '../sync/types'

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
  /** Pending local changes awaiting a cloud flush (added in v2; see lib/sync). */
  outbox!: EntityTable<OutboxRow, 'seq'>
  /** Prior values of edited entries, for recover-lost-information (added in v3). */
  history!: EntityTable<HistoryRow, 'seq'>
  /** Voice recordings (first-draft takes), stored as blobs (added in v3). */
  recordings!: EntityTable<Recording, 'id'>

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
    // v2 is additive: the cloud-sync outbox. Existing stores are unchanged.
    this.version(2).stores({
      outbox: '++seq, table, recordId, project_id, updated_at',
    })
    // v3: entry version history + voice recordings, plus a data migration for
    // the feature scale — the old 3-way Possible/Expected/Required select became
    // the 2-way Required/Common (old possible + expected map to common).
    this.version(3)
      .stores({
        history: '++seq, entry_id, project_id, changed_at',
        recordings: 'id, project_id, worksheet_id, created_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('entries')
          .toCollection()
          .modify((e: Entry) => {
            if (
              e.cell_key?.endsWith('__modality') &&
              (e.value === 'possible' || e.value === 'expected')
            ) {
              e.value = 'common'
            }
          })
      })
    // v4: data migration for the vitality scale — the old 3-way
    // Fading/Steady/Strong became the 5-way Extinct/Locked/Fading/Stable/
    // Thriving (Katie's 2026-07-20 categories). Old values map onto the
    // nearest new rung.
    this.version(4).upgrade(async (tx) => {
      const vitalityMap: Record<string, string> = {
        weak: 'fading',
        neutral: 'stable',
        strong: 'thriving',
      }
      await tx
        .table('entries')
        .where('node_id')
        .equals('s1b.vitality')
        .modify((e: Entry) => {
          if (e.value && vitalityMap[e.value]) e.value = vitalityMap[e.value]
        })
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
