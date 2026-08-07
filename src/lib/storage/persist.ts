/**
 * Ask the browser to stop treating this app's data as disposable.
 *
 * Everything a person types lives in IndexedDB, and the Supabase session token
 * lives in localStorage. Both sit in the same origin storage bucket, and by
 * default that bucket is "best-effort": the browser may evict all of it under
 * storage pressure, and Safari/iOS caps script-writable storage at seven days
 * without interaction regardless of pressure. Evicting it logs the person out
 * AND removes their answers in one step, which reads as the app losing work.
 *
 * `navigator.storage.persist()` moves the origin to "persistent", exempting it
 * from eviction. Chrome grants it silently for installed or high-engagement
 * sites; Firefox may prompt; Safari grants it to home-screen installs. A denial
 * is not a failure and must never block anything — it is a fact worth reporting,
 * which is why `storageDurability()` exists and why the account menu shows it.
 *
 * This is a mitigation, not the guarantee. Signing in is the guarantee: it puts
 * the answers in Supabase, so an eviction costs a re-login rather than the work.
 */

export type Durability = 'protected' | 'best-effort' | 'unknown'

/**
 * Request persistent storage. Safe to call repeatedly — once granted, the browser
 * short-circuits, so calling on start and again after sign-in costs nothing and
 * catches the engagement-based grant that only becomes available after use.
 */
export async function requestPersistentStorage(): Promise<Durability> {
  if (!navigator.storage?.persist) return 'unknown'
  try {
    // Already granted? Don't ask again; some browsers count repeat requests
    // against a heuristic.
    if (await navigator.storage.persisted?.()) return 'protected'
    return (await navigator.storage.persist()) ? 'protected' : 'best-effort'
  } catch {
    // A SecurityError in a sandboxed or private context is not worth surfacing;
    // the app works identically either way.
    return 'unknown'
  }
}

/** Current durability, without requesting anything. */
export async function storageDurability(): Promise<Durability> {
  if (!navigator.storage?.persisted) return 'unknown'
  try {
    return (await navigator.storage.persisted()) ? 'protected' : 'best-effort'
  } catch {
    return 'unknown'
  }
}
