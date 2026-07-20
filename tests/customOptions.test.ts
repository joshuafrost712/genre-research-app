import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/storage/db'
import { addCustomOption, getCustomOptions, mergeOptions } from '../src/lib/customOptions'
import { purposeCoverage } from '../src/lib/content/summarize'
import { findNode } from '../src/lib/content/loader'
import type { Entry } from '../src/lib/types'

const NODE_ID = 's1b.purpose_families'

describe('custom purpose options (spec 10 WP5)', () => {
  beforeEach(async () => {
    await db.meta.clear()
  })

  it('adds a custom option and dedupes case-insensitively', async () => {
    const node = findNode(NODE_ID)!.node
    const a = await addCustomOption('p1', node, '  Courting  ')
    expect(a?.label).toBe('Courting')
    expect(a?.id.startsWith('c_')).toBe(true)
    const b = await addCustomOption('p1', node, 'courting')
    expect(b?.id).toBe(a?.id)
    expect(await getCustomOptions('p1', NODE_ID)).toHaveLength(1)
  })

  it('returns the built-in option instead of duplicating it', async () => {
    const node = findNode(NODE_ID)!.node
    const opt = await addCustomOption('p1', node, 'Thanksgiving')
    expect(opt?.id).toBe('thanksgiving')
    expect(await getCustomOptions('p1', NODE_ID)).toHaveLength(0)
  })

  it('rejects blank labels and scopes options per project', async () => {
    const node = findNode(NODE_ID)!.node
    expect(await addCustomOption('p1', node, '   ')).toBeNull()
    await addCustomOption('p2', node, 'Courting')
    expect(await getCustomOptions('p1', NODE_ID)).toHaveLength(0)
    expect(await getCustomOptions('p2', NODE_ID)).toHaveLength(1)
  })

  it('mergeOptions appends custom options after built-ins without id collisions', () => {
    const node = findNode(NODE_ID)!.node
    const merged = mergeOptions(node, [
      { id: 'c_1', label: 'Courting' },
      { id: 'lament', label: 'Shadowing a built-in' },
    ])
    expect(merged.filter((o) => o.id === 'lament')).toHaveLength(1)
    expect(merged[merged.length - 1]).toEqual({ id: 'c_1', label: 'Courting' })
  })

  it('purposeCoverage includes custom families and still filters legacy other', () => {
    const entry = (genreId: string, value: string): Entry =>
      ({
        id: `e-${genreId}`,
        project_id: 'p1',
        node_id: NODE_ID,
        genre_id: genreId,
        value,
      }) as Entry
    const genres = [
      { id: 'g1', name: 'Lullaby' },
      { id: 'g2', name: 'War chant' },
    ]
    const cov = purposeCoverage(
      [entry('g1', JSON.stringify(['c_1', 'other'])), entry('g2', JSON.stringify(['praise']))],
      genres,
      [{ id: 'c_1', label: 'Courting' }],
    )
    const courting = cov.find((f) => f.id === 'c_1')
    expect(courting?.genreNames).toEqual(['Lullaby'])
    expect(cov.find((f) => f.id === 'other')).toBeUndefined()
    expect(cov.find((f) => f.id === 'entertaining')).toBeDefined()
  })
})
