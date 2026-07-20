/**
 * Genre-name integrity (feedback 2026-07-20 #12): no two genres may share a
 * name, and closely-spelled names are surfaced as possible doubles with an
 * offer to merge. Pure string helpers so the rules are testable without the UI
 * or IndexedDB.
 */

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Classic Levenshtein edit distance over the normalized names. */
export function editDistance(a: string, b: string): number {
  const s = normalizeName(a)
  const t = normalizeName(b)
  if (s === t) return 0
  if (!s.length) return t.length
  if (!t.length) return s.length
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s.length; i++) {
    const cur = [i]
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[t.length]
}

export type DuplicateKind = 'exact' | 'near'

export interface DuplicateMatch<T> {
  kind: DuplicateKind
  match: T
}

/**
 * How many edits still count as "probably the same name". Short names must
 * match exactly; longer names tolerate one or two slips (typos, a dropped
 * letter, a plural).
 */
function nearThreshold(length: number): number {
  if (length >= 10) return 2
  if (length >= 5) return 1
  return 0
}

/**
 * Check a (new or renamed) name against the existing list. Returns the first
 * exact match, else the closest near match, else null.
 */
export function findDuplicate<T extends { name: string }>(
  name: string,
  existing: T[],
): DuplicateMatch<T> | null {
  const norm = normalizeName(name)
  if (!norm) return null
  const exact = existing.find((g) => normalizeName(g.name) === norm)
  if (exact) return { kind: 'exact', match: exact }
  let best: { match: T; distance: number } | null = null
  for (const g of existing) {
    const d = editDistance(name, g.name)
    if (d <= nearThreshold(Math.min(norm.length, normalizeName(g.name).length))) {
      if (!best || d < best.distance) best = { match: g, distance: d }
    }
  }
  return best ? { kind: 'near', match: best.match } : null
}

/** Possible doubles already in the list (each pair reported once). */
export function duplicatePairs<T extends { name: string }>(genres: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []
  for (let i = 0; i < genres.length; i++) {
    for (let j = i + 1; j < genres.length; j++) {
      const a = genres[i]
      const b = genres[j]
      const exact = normalizeName(a.name) === normalizeName(b.name)
      const near =
        editDistance(a.name, b.name) <=
        nearThreshold(Math.min(normalizeName(a.name).length, normalizeName(b.name).length))
      if (exact || near) out.push([a, b])
    }
  }
  return out
}
