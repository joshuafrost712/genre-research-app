/**
 * Whose work is in this browser.
 *
 * The database is called `genre-research` and there is exactly one of it per
 * browser origin, forever. Nothing in the local schema is keyed by user: a
 * Project has no owner column, and the "which project is active" pointer is a
 * single global value in `meta`. That was harmless while the app was local-only
 * and became a real fault the moment accounts arrived, because two different
 * people now use the same device and the device could not tell them apart.
 *
 * The stamp below is the missing fact. It records which account the local data
 * belongs to, so that a DIFFERENT account signing in can be recognised as an
 * account switch rather than treated as the same person coming back.
 *
 * Two design points that are easy to get wrong:
 *
 * 1. It lives in Dexie `meta`, NOT localStorage. The stamp describes the data,
 *    so it has to be stored with the data — cleared together, evicted together,
 *    exported together. A stamp in a different bucket can outlive the rows it
 *    describes, or vice versa, and either way it starts lying.
 *
 * 2. It deliberately SURVIVES sign-out. The existing `genre.lastAccountEmail`
 *    marker does not (`forgetAccount`, by design, so that a chosen sign-out is
 *    not reported back as "you were signed out"), which is exactly why that
 *    marker cannot do this job: signing out is the first half of every account
 *    switch, so a marker cleared then is already gone by the time the second
 *    person arrives.
 */
import { getMetaValue, setMetaValue } from './appState'

const OWNER_UID = 'dataOwnerUid'
const OWNER_EMAIL = 'dataOwnerEmail'

export interface DataOwner {
  uid?: string
  email?: string
}

export async function getDataOwner(): Promise<DataOwner> {
  return {
    uid: await getMetaValue(OWNER_UID),
    email: await getMetaValue(OWNER_EMAIL),
  }
}

export async function setDataOwner(uid: string, email: string): Promise<void> {
  await setMetaValue(OWNER_UID, uid)
  if (email) await setMetaValue(OWNER_EMAIL, email)
}

/**
 * Is the local data someone else's?
 *
 * Unstamped is NOT a switch. A device that has never been claimed is either
 * brand new or belonged to someone before this shipped, and in both cases the
 * work on it is treated as the arriving person's — which is what makes the
 * ordinary "did some work signed out, then signed in" path keep working, rather
 * than throwing away the thing they just typed.
 *
 * The email comparison is the migration path, and it matters for exactly one
 * release: no device has a uid stamp yet, so without it the first sign-in after
 * this ships would claim whatever is already on the device and reproduce the bug
 * one final time on the very laptops that reported it. `lastAccountEmail` is the
 * only identity signal those devices carry.
 */
export function isDifferentPerson(owner: DataOwner, uid: string, email: string): boolean {
  if (owner.uid) return owner.uid !== uid
  if (owner.email && email) return owner.email.toLowerCase() !== email.toLowerCase()
  return false
}
