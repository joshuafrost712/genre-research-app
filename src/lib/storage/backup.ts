/**
 * A copy of everything on this device, in one file a person can keep.
 *
 * The existing exports (CSV, Word, PDF) are reports: they answer "show me the
 * work" and they are scoped to the ACTIVE project. That scoping is right for a
 * report and wrong for a backup, and the difference is not academic — a device
 * can hold several projects, `ExportView` only ever sees one of them, and the
 * others would be missing from a file the person believed was a full copy. A
 * backup that quietly omits data is worse than no backup, so this walks the
 * database rather than the report model.
 *
 * It exists because a guest at the Bali workshop opened the app from a chat link
 * on an iPhone, typed a session's worth of notes, and then found the app empty
 * with no way to have taken a copy off the device first.
 *
 * ## What is left out, and why
 *
 * - `recordings` — voice takes, stored as Blobs. `JSON.stringify` turns a Blob
 *   into `{}`, so including them would write a file that LOOKS complete and
 *   silently contains no audio. Base64 is the alternative and would add tens of
 *   megabytes to a file being written on a phone. Named in `omitted` so the
 *   file admits what it does not carry.
 * - `outbox`, `translationQueue` — per-device working state, meaningful only
 *   against this browser's sync position. Restoring them elsewhere would replay
 *   or duplicate work.
 * - identity keys inside `meta` — see `IDENTITY_META`.
 *
 * ## Restore is a merge, never a replace
 *
 * `bulkPut` adds and overwrites by primary key and leaves untouched rows alone.
 * A restore therefore cannot destroy work the device already holds, which is the
 * failure mode that matters when someone imports the wrong file into a device
 * they have been working on all morning.
 */
import { db } from './db'
import { setMetaValue } from './appState'
import { trackUpsert } from '../sync/outbox'
import { SYNC_TABLES } from '../sync/types'

export const BACKUP_FORMAT = 1
const APP_TAG = 'genre-research'

/** Tables the backup carries, in dependency order so a restore reads sensibly. */
const BACKUP_TABLES = [
  'projects',
  'focusTexts',
  'genres',
  'worksheets',
  'capturedNotes',
  'entries',
  'persons',
  'history',
  'meta',
] as const

const OMITTED_TABLES = ['recordings', 'outbox', 'translationQueue'] as const

/**
 * `meta` keys that name a PERSON or a DEVICE rather than describing the work.
 *
 * Excluded in both directions, deliberately. Two of them do real damage if
 * transplanted:
 *
 * - `dataOwnerUid` / `dataOwnerEmail` stamp the device as belonging to an
 *   account. Carry them onto another device and the next sign-in by its rightful
 *   owner reads as an account switch, which calls `resetLocalData` and wipes the
 *   very work that was just restored.
 * - `syncAuthorId` names this device's sync shard. Two devices sharing one id
 *   write over each other's shard.
 *
 * The rest are ordinary privacy: a backup passed to a colleague should not carry
 * a Google account address.
 */
const IDENTITY_META = new Set([
  'dataOwnerUid',
  'dataOwnerEmail',
  'syncAuthorId',
  'account.email',
  'account.name',
  'account.photo',
  'durabilityProbe',
])

export interface BackupFile {
  app: typeof APP_TAG
  format: number
  created_at: string
  /** Tables deliberately not included. Present so the file is self-describing. */
  omitted: readonly string[]
  counts: Record<string, number>
  tables: Record<string, unknown[]>
}

/** Every project, answer and note on this device, as a plain object. */
export async function buildBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}

  for (const name of BACKUP_TABLES) {
    const rows = await db.table(name).toArray()
    const kept =
      name === 'meta'
        ? (rows as { key: string }[]).filter((r) => !IDENTITY_META.has(r.key))
        : rows
    tables[name] = kept
    counts[name] = kept.length
  }

  return {
    app: APP_TAG,
    format: BACKUP_FORMAT,
    created_at: new Date().toISOString(),
    omitted: OMITTED_TABLES,
    counts,
    tables,
  }
}

export function backupFilename(date: Date = new Date()): string {
  // Local date, not ISO: the file is named for the day the person made it, and a
  // UTC stamp reads as the wrong day for most of the workshop's time zones.
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `genre-research-backup-${stamp}.json`
}

/**
 * Build the file and hand it to the browser, recording that it happened.
 *
 * Lives here rather than in a component because two surfaces need it — the
 * Export page and the at-risk banner — and a second copy of the anchor-click
 * dance is how one of them ends up not recording `lastBackupAt`.
 *
 * MUST be called from a user gesture. iOS Safari blocks a programmatic download
 * without one, and there is no File System Access API there to fall back on, so
 * a genuinely automatic backup is not possible on the device this was built for.
 * The app can prompt; only the person can save.
 */
export const LAST_BACKUP_KEY = 'lastBackupAt'

export async function saveBackupFile(): Promise<BackupFile> {
  const file = await buildBackup()
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename()
  a.click()
  URL.revokeObjectURL(url)
  await setMetaValue(LAST_BACKUP_KEY, file.created_at)
  return file
}

export class BackupFormatError extends Error {}

/**
 * Validate an untrusted file before it touches the database.
 *
 * A backup arrives from the filesystem, so it is input like any other: a wrong
 * file picked from a crowded Files app is the common case, not an attack. It
 * fails loudly here rather than half-importing and leaving a mess.
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupFormatError('That file is not a backup file.')
  }
  if (!raw || typeof raw !== 'object') throw new BackupFormatError('That file is not a backup file.')

  const file = raw as Partial<BackupFile>
  if (file.app !== APP_TAG) {
    throw new BackupFormatError('That backup is from a different app.')
  }
  if (typeof file.format !== 'number' || file.format > BACKUP_FORMAT) {
    // A newer file may contain tables and columns this build has never heard of.
    // Refusing is the honest response; importing half of it is not.
    throw new BackupFormatError(
      'That backup was made by a newer version of the app. Update the app, then try again.',
    )
  }
  if (!file.tables || typeof file.tables !== 'object') {
    throw new BackupFormatError('That backup file is incomplete.')
  }
  return { ...(file as BackupFile), omitted: file.omitted ?? [] }
}

export interface RestoreResult {
  restored: Record<string, number>
  total: number
}

/**
 * Merge a backup into this device.
 *
 * Runs in one transaction so a failure part-way cannot leave a device holding
 * half a restore. Rows for synced tables are then queued to the outbox, because
 * a restore that only lands locally would be lost again by the next eviction —
 * the whole point is to get the work somewhere durable.
 */
export async function restoreBackup(file: BackupFile): Promise<RestoreResult> {
  const restored: Record<string, number> = {}
  const known = new Set(db.tables.map((t) => t.name))

  await db.transaction('rw', db.tables, async () => {
    for (const name of BACKUP_TABLES) {
      // A table missing from an older file is not an error; nothing to restore.
      const rows = file.tables[name]
      if (!Array.isArray(rows) || rows.length === 0 || !known.has(name)) continue

      const kept =
        name === 'meta'
          ? (rows as { key?: string }[]).filter(
              (r) => typeof r?.key === 'string' && !IDENTITY_META.has(r.key),
            )
          : rows

      if (kept.length === 0) continue
      await db.table(name).bulkPut(kept)
      restored[name] = kept.length
    }
  })

  // Outside the transaction: enqueueing is itself a write to `outbox`, and the
  // sync engine's listener fires on it, so doing this inside would either
  // deadlock on the same tables or push rows a rollback then removed.
  for (const name of SYNC_TABLES) {
    const rows = file.tables[name]
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const record = row as { id?: string; project_id?: string; updated_at?: string }
      if (typeof record.id === 'string') {
        await trackUpsert(name, record as { id: string; project_id?: string; updated_at?: string })
      }
    }
  }

  return { restored, total: Object.values(restored).reduce((a, b) => a + b, 0) }
}
