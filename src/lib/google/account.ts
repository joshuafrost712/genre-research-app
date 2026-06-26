/**
 * Persisted account identity + a stable per-device author id, both kept in the
 * Dexie `meta` k/v store. Identity is the signed-in Google account (email/name);
 * we store no passwords. The author id is a per-device UUID used to name this
 * device's sync shard so two devices for the same person merge cleanly.
 */
import { db } from '../storage/db'
import { uid } from '../util'

const EMAIL = 'account.email'
const NAME = 'account.name'
const PHOTO = 'account.photo'
const AUTHOR = 'syncAuthorId'

async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}
async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

export interface Account {
  email: string
  name?: string
  photo?: string
}

export async function saveAccount(a: Account): Promise<void> {
  await setMeta(EMAIL, a.email)
  if (a.name) await setMeta(NAME, a.name)
  if (a.photo) await setMeta(PHOTO, a.photo)
}

export async function getAccount(): Promise<Account | null> {
  const email = await getMeta(EMAIL)
  if (!email) return null
  return { email, name: await getMeta(NAME), photo: await getMeta(PHOTO) }
}

export async function clearAccount(): Promise<void> {
  await db.meta.bulkDelete([EMAIL, NAME, PHOTO])
}

/** Stable id for THIS device, generated once and reused. */
export async function getSyncAuthorId(): Promise<string> {
  const existing = await getMeta(AUTHOR)
  if (existing) return existing
  const id = uid()
  await setMeta(AUTHOR, id)
  return id
}