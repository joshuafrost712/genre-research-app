import { describe, expect, it } from 'vitest'
import {
  deriveShortlist,
  keepGenre,
  setAsideGenre,
  setRestAside,
  KEEP_CAP,
} from '../src/lib/chooseShortlist'

const g = (id: string) => ({ id })
const genres = ['a', 'b', 'c', 'd', 'e'].map(g)

describe('2b keep / set-aside tri-state (spec 10 WP7, feedback #21)', () => {
  it('starts everything undecided — nothing is "set aside" the user never chose', () => {
    const v = deriveShortlist(genres, [], [])
    expect(v.undecided.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(v.kept).toEqual([])
    expect(v.setAside).toEqual([])
    expect(v.atCap).toBe(false)
  })

  it('keeping one genre leaves the rest undecided, not set aside', () => {
    const ids = keepGenre({ keptIds: [], setAsideIds: [] }, 'a')
    const v = deriveShortlist(genres, ids.keptIds, ids.setAsideIds)
    expect(v.kept.map((x) => x.id)).toEqual(['a'])
    expect(v.setAside).toEqual([])
    expect(v.undecided).toHaveLength(4)
  })

  it('caps keeps at KEEP_CAP and ignores further keeps', () => {
    let ids = { keptIds: [] as string[], setAsideIds: [] as string[] }
    for (const x of ['a', 'b', 'c', 'd']) ids = keepGenre(ids, x)
    expect(ids.keptIds).toEqual(['a', 'b', 'c'])
    expect(KEEP_CAP).toBe(3)
    expect(deriveShortlist(genres, ids.keptIds, ids.setAsideIds).atCap).toBe(true)
  })

  it('set-aside moves a kept genre out and keeping it again brings it back', () => {
    let ids = keepGenre({ keptIds: [], setAsideIds: [] }, 'a')
    ids = setAsideGenre(ids, 'a')
    let v = deriveShortlist(genres, ids.keptIds, ids.setAsideIds)
    expect(v.setAside.map((x) => x.id)).toEqual(['a'])
    ids = keepGenre(ids, 'a')
    v = deriveShortlist(genres, ids.keptIds, ids.setAsideIds)
    expect(v.kept.map((x) => x.id)).toEqual(['a'])
    expect(v.setAside).toEqual([])
  })

  it('setRestAside sends only the undecided genres to set-aside', () => {
    let ids = { keptIds: ['a'], setAsideIds: ['b'] }
    ids = setRestAside(ids, genres.map((x) => x.id))
    expect(ids.keptIds).toEqual(['a'])
    expect(ids.setAsideIds.sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('legacy data (shortlist only, no set-aside entry) surfaces the rest as undecided', () => {
    const v = deriveShortlist(genres, ['a', 'b'], [])
    expect(v.kept.map((x) => x.id)).toEqual(['a', 'b'])
    expect(v.setAside).toEqual([])
    expect(v.undecided.map((x) => x.id)).toEqual(['c', 'd', 'e'])
  })
})
