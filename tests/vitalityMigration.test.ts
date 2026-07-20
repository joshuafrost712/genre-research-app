import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'

/**
 * The v4 upgrade remaps stored vitality answers from the old 3-way scale
 * (weak/neutral/strong) onto the 5-way Extinct/Locked/Fading/Stable/Thriving
 * scale (feedback 2026-07-20 evening #13, spec 10).
 *
 * Seeds a database at the v3 schema BEFORE the app's Dexie class ever opens,
 * then imports the real db module so its version(4).upgrade runs.
 */
describe('v4 vitality scale migration', () => {
  it('maps weak→fading, neutral→stable, strong→thriving; leaves other entries alone', async () => {
    const old = new Dexie('genre-research')
    old.version(3).stores({
      projects: 'id, updated_at',
      focusTexts: 'id, project_id',
      genres: 'id, project_id, name',
      worksheets: 'id, project_id, focus_text_id, genre_id, status',
      capturedNotes: 'id, project_id, created_at',
      entries:
        'id, project_id, node_id, captured_note_id, genre_id, focus_text_id, worksheet_id, routing_status, sync_status, updated_at',
      persons: 'id, project_id',
      meta: 'key',
      outbox: '++seq, table, recordId, project_id, updated_at',
      history: '++seq, entry_id, project_id, changed_at',
      recordings: 'id, project_id, worksheet_id, created_at',
    })
    await old.table('entries').bulkPut([
      { id: 'e1', project_id: 'p1', node_id: 's1b.vitality', value: 'weak' },
      { id: 'e2', project_id: 'p1', node_id: 's1b.vitality', value: 'neutral' },
      { id: 'e3', project_id: 'p1', node_id: 's1b.vitality', value: 'strong' },
      // already on the new scale: must pass through untouched
      { id: 'e4', project_id: 'p1', node_id: 's1b.vitality', value: 'locked' },
      // a non-vitality select that happens to share a value id: untouched
      { id: 'e5', project_id: 'p1', node_id: 's0.purpose.broad_genre', value: 'other' },
    ])
    old.close()

    const { db } = await import('../src/lib/storage/db')
    const byId = async (id: string) => (await db.entries.get(id))?.value
    expect(await byId('e1')).toBe('fading')
    expect(await byId('e2')).toBe('stable')
    expect(await byId('e3')).toBe('thriving')
    expect(await byId('e4')).toBe('locked')
    expect(await byId('e5')).toBe('other')
    db.close()
  })
})
