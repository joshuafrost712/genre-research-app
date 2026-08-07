/**
 * A stable id for THIS device, used as the last-write-wins tiebreak and to
 * recognise our own rows coming back from a pull.
 *
 * It reads and writes the same `syncAuthorId` meta key the Google sync used, so
 * a device that already had one keeps it. Kept here rather than in lib/google/
 * because it is no longer anything to do with Google.
 */
import { db } from '../storage/db'
import { uid } from '../util'

const AUTHOR = 'syncAuthorId'

let cached: string | null = null

export async function getAuthorId(): Promise<string> {
  if (cached) return cached
  const existing = (await db.meta.get(AUTHOR))?.value
  if (existing) {
    cached = existing
    return existing
  }
  const id = uid()
  await db.meta.put({ key: AUTHOR, value: id })
  cached = id
  return id
}

/** Synchronous read for hot paths; empty until getAuthorId() has run once. */
export function authorIdSync(): string {
  return cached ?? ''
}
