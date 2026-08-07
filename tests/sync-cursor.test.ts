import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { getCursor, setCursor, resetCursor } from '../src/lib/sync/supabase/pull'

describe('pull cursor', () => {
  beforeEach(async () => {
    await db.meta.clear()
  })

  it('rewinds two seconds on save, so a row committed on the boundary is not stepped over', async () => {
    // Two rows can be assigned server_at values either side of the instant we
    // read the page. An exact cursor walks past the straggler and it is never
    // seen again; merge is idempotent, so overlapping is free insurance.
    await setCursor('p1', '2026-08-06T10:00:10.000Z')
    expect(await getCursor('p1')).toBe('2026-08-06T10:00:08.000Z')
  })

  it('keeps a cursor per project', async () => {
    await setCursor('p1', '2026-08-06T10:00:10.000Z')
    await setCursor('p2', '2026-08-06T11:00:10.000Z')
    expect(await getCursor('p1')).toBe('2026-08-06T10:00:08.000Z')
    expect(await getCursor('p2')).toBe('2026-08-06T11:00:08.000Z')
  })

  it('is undefined before the first pull, which is what makes a first pull a full read', async () => {
    expect(await getCursor('never-seen')).toBeUndefined()
  })

  it('resets to undefined so a project can be re-read from the start', async () => {
    await setCursor('p1', '2026-08-06T10:00:10.000Z')
    await resetCursor('p1')
    expect(await getCursor('p1')).toBeUndefined()
  })
})
