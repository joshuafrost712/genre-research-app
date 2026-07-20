/**
 * The 2b step-2 keep / set-aside model (feedback 2026-07-20 evening #21).
 *
 * Three states per genre: kept (on the shortlist), explicitly set aside, or
 * undecided (neither — the starting state, so a genre never shows "Bring back"
 * before anyone chose to set it aside). Kept is capped at KEEP_CAP.
 */
export const KEEP_CAP = 3

export interface ShortlistView<T extends { id: string }> {
  kept: T[]
  setAside: T[]
  undecided: T[]
  atCap: boolean
}

export function deriveShortlist<T extends { id: string }>(
  genres: T[],
  keptIds: string[],
  setAsideIds: string[],
): ShortlistView<T> {
  const kept = genres.filter((g) => keptIds.includes(g.id))
  const setAside = genres.filter((g) => setAsideIds.includes(g.id) && !keptIds.includes(g.id))
  const undecided = genres.filter(
    (g) => !keptIds.includes(g.id) && !setAsideIds.includes(g.id),
  )
  return { kept, setAside, undecided, atCap: kept.length >= KEEP_CAP }
}

export interface ShortlistIds {
  keptIds: string[]
  setAsideIds: string[]
}

/** Keep a genre (from undecided or set-aside). No-op when already at the cap. */
export function keepGenre(ids: ShortlistIds, id: string): ShortlistIds {
  if (ids.keptIds.includes(id)) return ids
  if (ids.keptIds.length >= KEEP_CAP) return ids
  return {
    keptIds: [...ids.keptIds, id],
    setAsideIds: ids.setAsideIds.filter((x) => x !== id),
  }
}

/** Explicitly set a genre aside (from kept or undecided). */
export function setAsideGenre(ids: ShortlistIds, id: string): ShortlistIds {
  return {
    keptIds: ids.keptIds.filter((x) => x !== id),
    setAsideIds: ids.setAsideIds.includes(id) ? ids.setAsideIds : [...ids.setAsideIds, id],
  }
}

/** "Set the rest aside": every undecided genre becomes explicitly set aside. */
export function setRestAside(ids: ShortlistIds, allGenreIds: string[]): ShortlistIds {
  const rest = allGenreIds.filter(
    (id) => !ids.keptIds.includes(id) && !ids.setAsideIds.includes(id),
  )
  return rest.reduce(setAsideGenre, ids)
}
