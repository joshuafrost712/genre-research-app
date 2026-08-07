/**
 * The Google sign-in action, kept separate from the app's own account so the
 * header `AccountMenu` can offer it as what it is: an optional Drive connection.
 * Requests the non-sensitive `drive.file` scope, reads the user's identity and
 * persists the account. Returns it; throws if the user cancels or it fails.
 *
 * It no longer touches the sync engine. Cloud sync runs on the Supabase session
 * and starts itself from an auth state change, so connecting Drive is now purely
 * about saving a copy to Drive and nothing else depends on it.
 */
import { ensureScope, fetchIdentity } from './auth'
import { saveAccount, type Account } from './account'

export async function signInWithGoogle(): Promise<Account> {
  await ensureScope('file')
  const identity = await fetchIdentity()
  const account: Account = { email: identity.email, name: identity.name, photo: identity.photo }
  await saveAccount(account)
  return account
}
