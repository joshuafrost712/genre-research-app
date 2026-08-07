import { describe, expect, it } from 'vitest'
import { collapse } from '../src/lib/sync/supabase/push'
import type { OutboxRow } from '../src/lib/sync/types'

function row(
  seq: number,
  recordId: string,
  updated_at: string,
  text: string,
  project_id = 'p1',
): OutboxRow {
  return {
    seq,
    table: 'entries',
    recordId,
    project_id,
    op: 'upsert',
    updated_at,
    data: { id: recordId, text },
  }
}

describe('collapse (outbox -> push batches)', () => {
  it('keeps only the newest row per key but remembers every seq it replaced', () => {
    // What a 400ms typing debounce inside one flush window actually leaves behind.
    const rows = [
      row(1, 'e1', '2026-08-06T10:00:00.000Z', 'h'),
      row(2, 'e1', '2026-08-06T10:00:00.400Z', 'he'),
      row(3, 'e1', '2026-08-06T10:00:00.800Z', 'hel'),
      row(4, 'e1', '2026-08-06T10:00:01.200Z', 'hello'),
    ]
    const [batch] = collapse(rows, 'dev-a')

    expect(batch.records).toHaveLength(1)
    expect((batch.records[0] as { data: { text: string } }).data.text).toBe('hello')
    // All four must clear, or the superseded rows push again next cycle forever.
    expect(batch.seqs.sort()).toEqual([1, 2, 3, 4])
  })

  it('sends one record per key, so ON CONFLICT cannot hit a row twice', () => {
    const rows = [
      row(1, 'e1', '2026-08-06T10:00:00.000Z', 'a'),
      row(2, 'e2', '2026-08-06T10:00:00.100Z', 'b'),
      row(3, 'e1', '2026-08-06T10:00:00.200Z', 'c'),
    ]
    const [batch] = collapse(rows, 'dev-a')
    const keys = batch.records.map((r) => (r as { record_id: string }).record_id)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.sort()).toEqual(['e1', 'e2'])
  })

  it('breaks a same-millisecond tie by outbox order, not by timestamp', () => {
    // Two keystrokes inside one millisecond share an ISO string; insertion order
    // is the only remaining evidence of which came second.
    const same = '2026-08-06T10:00:00.000Z'
    const [batch] = collapse([row(1, 'e1', same, 'first'), row(2, 'e1', same, 'second')], 'dev-a')
    expect((batch.records[0] as { data: { text: string } }).data.text).toBe('second')
  })

  it('separates projects so one push cannot carry another project rows', () => {
    const batches = collapse(
      [
        row(1, 'e1', '2026-08-06T10:00:00.000Z', 'a', 'p1'),
        row(2, 'e2', '2026-08-06T10:00:00.000Z', 'b', 'p2'),
      ],
      'dev-a',
    )
    expect(batches).toHaveLength(2)
    expect(batches.map((b) => b.projectId).sort()).toEqual(['p1', 'p2'])
  })

  it('stamps this device as the author, which is the last-write-wins tiebreak', () => {
    const [batch] = collapse([row(1, 'e1', '2026-08-06T10:00:00.000Z', 'a')], 'dev-xyz')
    expect((batch.records[0] as { author_id: string }).author_id).toBe('dev-xyz')
  })

  it('drops the payload on a delete, since a tombstone carries no row', () => {
    const rows: OutboxRow[] = [
      {
        seq: 1,
        table: 'entries',
        recordId: 'e1',
        project_id: 'p1',
        op: 'delete',
        updated_at: '2026-08-06T10:00:00.000Z',
      },
    ]
    const [batch] = collapse(rows, 'dev-a')
    expect((batch.records[0] as { op: string; data: unknown }).op).toBe('delete')
    expect((batch.records[0] as { data: unknown }).data).toBeNull()
  })

  it('ignores rows with no seq, which cannot be cleared afterwards', () => {
    const orphan = { ...row(0, 'e1', '2026-08-06T10:00:00.000Z', 'a'), seq: undefined }
    expect(collapse([orphan], 'dev-a')).toHaveLength(0)
  })
})
