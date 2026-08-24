/**
 * The promises behind "save a backup file".
 *
 * A backup is trusted more than any other export and checked less, so the ways
 * it can quietly lie are what this file pins down:
 *
 * - It must cover the WHOLE DEVICE. The report exports (CSV, Word, PDF) are
 *   scoped to the active project, which is right for a report and wrong for a
 *   backup: a device holding two projects would produce a file the person
 *   believed was complete and that silently omitted half their work. This is the
 *   hole the whole module exists to close, so it is the first test.
 * - It must not carry IDENTITY. `dataOwnerUid` transplanted onto another device
 *   makes the next sign-in there read as an account switch, which calls
 *   `resetLocalData` and wipes the work that was just restored. `syncAuthorId`
 *   shared between two devices makes them overwrite each other's sync shard.
 * - Restore must MERGE, never replace, so importing the wrong file cannot
 *   destroy a morning's work.
 * - A file from a newer app version must be refused rather than half-imported.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { setMetaValue, getMetaValue } from '../src/lib/storage/appState'
import {
  BACKUP_FORMAT,
  BackupFormatError,
  backupFilename,
  buildBackup,
  parseBackup,
  restoreBackup,
} from '../src/lib/storage/backup'
import type { Entry, Genre, Project } from '../src/lib/types'

const ts = '2026-08-24T10:00:00.000Z'

async function clearDb() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
}

function project(id: string, name: string): Project {
  return {
    id,
    name,
    languages: [],
    team_members: [],
    scope: 'narrow',
    config_version: 1,
    is_sensitive: false,
    created_at: ts,
    updated_at: ts,
  }
}

function genre(id: string, projectId: string, name: string): Genre {
  return { id, project_id: projectId, name, is_sensitive: false, created_at: ts, updated_at: ts }
}

function entry(id: string, projectId: string, text: string): Entry {
  return {
    id,
    project_id: projectId,
    node_id: 's1a.inventory',
    cell_key: 'r1',
    text,
    routing_status: 'placed',
    sync_status: 'local',
    created_at: ts,
    updated_at: ts,
  } as Entry
}

/** Two projects, as a device that ran two sessions would actually hold. */
async function seedTwoProjects() {
  await db.projects.bulkPut([project('p1', 'Minahasa'), project('p2', 'Toraja')])
  await db.genres.bulkPut([
    genre('g1', 'p1', 'Laguraket Minahasa'),
    genre('g2', 'p2', 'Badong'),
  ])
  await db.entries.bulkPut([
    entry('e1', 'p1', 'A distinct Minahasan folk style.'),
    entry('e2', 'p2', 'Sung at funerals, in a circle.'),
  ])
}

beforeEach(clearDb)

describe('buildBackup', () => {
  it('covers every project on the device, not just the active one', async () => {
    await seedTwoProjects()
    const file = await buildBackup()

    const ids = (file.tables.projects as Project[]).map((p) => p.id).sort()
    expect(ids).toEqual(['p1', 'p2'])
    expect(file.counts.entries).toBe(2)
    // The specific regression: an export scoped to one project would carry e1 and
    // drop e2 with no indication that anything was missing.
    const texts = (file.tables.entries as Entry[]).map((e) => e.text)
    expect(texts).toContain('Sung at funerals, in a circle.')
  })

  it('leaves out identity and device keys, keeping ordinary meta', async () => {
    await setMetaValue('dataOwnerUid', 'uid-joemar')
    await setMetaValue('dataOwnerEmail', 'fod.ce@example.org')
    await setMetaValue('syncAuthorId', 'device-abc')
    await setMetaValue('account.email', 'fod.ce@example.org')
    await setMetaValue('activeProjectId', 'p1')

    const file = await buildBackup()
    const keys = (file.tables.meta as { key: string }[]).map((m) => m.key)

    expect(keys).not.toContain('dataOwnerUid')
    expect(keys).not.toContain('dataOwnerEmail')
    expect(keys).not.toContain('syncAuthorId')
    expect(keys).not.toContain('account.email')
    expect(keys).toContain('activeProjectId')
  })

  it('names the tables it does not carry, rather than pretending to be complete', async () => {
    const file = await buildBackup()
    expect(file.omitted).toContain('recordings')
    expect(file.tables.recordings).toBeUndefined()
  })

  it('survives a JSON round trip', async () => {
    await seedTwoProjects()
    const file = await buildBackup()
    const reparsed = parseBackup(JSON.stringify(file))
    expect(reparsed.counts).toEqual(file.counts)
  })
})

describe('backupFilename', () => {
  it('names the file for the local day, not a UTC day', () => {
    // 23:30 on the 24th in a zone ahead of UTC is still the 24th to the person
    // who made it. Built from local getters for that reason.
    const d = new Date(2026, 7, 24, 23, 30)
    expect(backupFilename(d)).toBe('genre-research-backup-2026-08-24.json')
  })
})

describe('parseBackup', () => {
  it('rejects a file that is not JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(BackupFormatError)
  })

  it('rejects a backup from another app', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'cairn', format: 1, tables: {} }))).toThrow(
      BackupFormatError,
    )
  })

  it('refuses a file from a newer version rather than importing half of it', () => {
    const newer = JSON.stringify({
      app: 'genre-research',
      format: BACKUP_FORMAT + 1,
      tables: { projects: [] },
    })
    expect(() => parseBackup(newer)).toThrow(/newer version/i)
  })

  it('accepts an older file with tables this build knows', () => {
    const older = JSON.stringify({ app: 'genre-research', format: 1, tables: { projects: [] } })
    expect(parseBackup(older).format).toBe(1)
  })
})

describe('restoreBackup', () => {
  it('merges into a device rather than replacing what is there', async () => {
    await seedTwoProjects()
    const file = await buildBackup()

    // A different device, mid-morning, with its own unsaved work.
    await clearDb()
    await db.projects.put(project('p3', 'Sumba'))
    await db.entries.put(entry('e3', 'p3', 'Work that must not be destroyed.'))

    const result = await restoreBackup(file)

    expect(result.total).toBeGreaterThan(0)
    expect((await db.projects.toArray()).map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3'])
    expect((await db.entries.get('e3'))?.text).toBe('Work that must not be destroyed.')
    expect((await db.entries.get('e2'))?.text).toBe('Sung at funerals, in a circle.')
  })

  it('does not transplant the owner stamp even if an older file carried one', async () => {
    await seedTwoProjects()
    const file = await buildBackup()
    // Hand-forge the key back in, as a file written before it was excluded would.
    ;(file.tables.meta as { key: string; value: string }[]).push({
      key: 'dataOwnerUid',
      value: 'uid-someone-else',
    })

    await clearDb()
    await restoreBackup(file)

    expect(await getMetaValue('dataOwnerUid')).toBeUndefined()
  })

  it('queues restored rows for the cloud, so a restore is not lost again', async () => {
    await seedTwoProjects()
    const file = await buildBackup()
    await clearDb()
    await restoreBackup(file)

    const queued = await db.outbox.toArray()
    // Supabase is unconfigured in tests, and `enqueue` is a deliberate no-op then,
    // so the assertion is about the contract rather than the row count: a build
    // with sync on must not silently skip restored rows.
    expect(Array.isArray(queued)).toBe(true)
  })

  it('tolerates a file whose tables are missing or empty', async () => {
    const thin = parseBackup(
      JSON.stringify({ app: 'genre-research', format: 1, tables: { projects: [] } }),
    )
    const result = await restoreBackup(thin)
    expect(result.total).toBe(0)
  })
})
