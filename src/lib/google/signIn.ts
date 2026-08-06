/**
 * The Google sign-in action, kept separate from the app's own account so the
 * header `AccountMenu` can offer it as what it is: an optional Drive connection.
 * Requests the non-sensitive `drive.file` scope, reads the user's identity,
 * ensures a per-device sync id, persists the account, and starts the sync
 * engine. Returns the saved account; throws if the user cancels or it fails.
 */
import { ensureScope, fetchIdentity } from './auth'
import { getSyncAuthorId, saveAccount, type Account } from './account'
import { syncEngine } from '../sync/engine'

export async function signInWithGoogle(): Promise<Account> {
  await ensureScope('file')
  const identity = await fetchIdentity()
  await getSyncAuthorId() // create the per-device id on first sign-in
  const account: Account = { email: identity.email, name: identity.name, photo: identity.photo }
  await saveAccount(account)
  void syncEngine.start()
  return account
}
