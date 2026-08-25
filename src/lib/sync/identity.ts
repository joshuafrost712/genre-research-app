/**
 * Who "I" am, for authorship of an answer.
 *
 * `author.ts` already mints a stable id per DEVICE, which is what the sync
 * layer needs: it names a shard and breaks last-write-wins ties. Authorship is a
 * different question with a different answer. A person with a laptop and an
 * iPad is one author, and treating their two devices as two people means their
 * own edit comes back as "a teammate replaced your answer".
 *
 * So authorship prefers the ACCOUNT id (`dataOwnerUid`, stamped on sign-in by
 * `resolveOwnership`) and falls back to the device id when there is no account
 * yet.
 *
 * Reading it back needs both, which is the part that is easy to get wrong.
 * Working offline and signing in afterwards is the app's ordinary path, not an
 * edge case (see `owner.ts`), so answers typed before that sign-in carry the
 * DEVICE id while everything written after carries the ACCOUNT id. Comparing
 * against only one of them would make a person's own earlier work stop counting
 * as theirs. `myAuthorIds` returns the set; match against it, never against a
 * single string.
 */
import { getDataOwner } from '../storage/owner'
import { getAuthorId } from './author'

/**
 * The account id, remembered once it exists.
 *
 * This is on the typing path — every debounced keystroke writes an entry — and
 * on the merge path, which runs every three seconds. Two Dexie reads per call
 * are cheap individually and not free on a workshop tablet importing a
 * project's worth of answers.
 *
 * Only a FOUND id is cached. An absent one means nobody has signed in yet, and
 * that changes; caching it would leave a session stamping the device id after
 * its owner signed in. The reverse cannot happen: an account switch wipes the
 * database and reloads the page (`resetLocalData`), so this module never
 * outlives the account it cached.
 */
let account: string | null = null

async function accountId(): Promise<string> {
  if (account) return account
  const owner = await getDataOwner()
  if (owner.uid) account = owner.uid
  return owner.uid ?? ''
}

/** Drop the remembered account id. For tests, and for sign-out. */
export function forgetIdentity(): void {
  account = null
}

/** The id to stamp on a write: the account when known, else this device. */
export async function currentAuthor(): Promise<string> {
  return (await accountId()) || (await getAuthorId())
}

/** Every id that means "me". Match a stored `last_author` against this. */
export async function myAuthorIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  const uid = await accountId()
  if (uid) ids.add(uid)
  ids.add(await getAuthorId())
  return ids
}
