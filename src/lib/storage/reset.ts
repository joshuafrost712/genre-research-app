/**
 * Emptying this device so a different person can start clean.
 *
 * The bug this exists for: a second account created on a laptop that had already
 * been used saw all of the first person's worksheets. That is bad on its own, and
 * the half that does real damage is quieter — on the first sync cycle after any
 * sign-in, `publishOwnProjects` published every local project with work in it
 * under the new `auth.uid()`. So the previous person's work was not merely shown
 * to the newcomer, it was uploaded into the newcomer's account, where
 * last-write-wins merging could then overwrite the original.
 *
 * A device must not carry one person's data into another person's account.
 */
import { db } from './db'
import { setDataOwner } from './owner'

/**
 * localStorage entries that identify a PERSON rather than a device, and so must
 * not survive a handover. Listed here rather than each module clearing its own,
 * so that "what belongs to the person" is answered in one readable place.
 *
 * - `genre.feedback.author`  — stamps their name on comments (lib/feedback/identity.ts)
 * - `genre.lastAccountEmail` — the "you were signed out" marker (supabase/accountMemory.ts)
 * - `genre.routing.github_token` — a real credential (routing/config.ts), and the
 *   one entry here that would be a security problem rather than a confusion if it
 *   were left behind on a shared machine.
 *
 * Deliberately NOT cleared: `locale` and `depthMode`, which are preferences of
 * the screen in front of you, and Supabase's own `sb-*-auth-token`, which the
 * arriving person's session legitimately owns.
 */
const PERSONAL_KEYS = [
  'genre.feedback.author',
  'genre.lastAccountEmail',
  'genre.routing.github_token',
]

/** Told to the reloaded page so it can explain itself once. */
export const SWITCH_NOTICE_KEY = 'genre.switchedTo'
const RELOAD_GUARD_KEY = 'genre.resetReloads'

/**
 * Clear every local trace of the previous account and hand the device to `user`.
 *
 * Reloads the page rather than resetting in place, and that is a considered
 * choice, not laziness. The cleared rows are referenced by React state, by
 * `ActiveContextProvider`, by the content cache, by the outbox's subscribers, and
 * by the sync engine's own `bootstrapped` / `peersSeen` / `forbidden` module
 * state. Re-deriving each of those by hand is a long tail of stale-state bugs of
 * exactly the kind this function is trying to end. The session is already
 * persisted, so a reload lands signed in, with an empty database, on a clean
 * bootstrap path that is already well tested — it is the same code path as a
 * first-ever visit.
 */
export async function resetLocalData(user: { id: string; email: string }): Promise<void> {
  // One transaction over every table, so a failure part-way cannot leave a
  // half-wiped device that looks fine. `db.tables` rather than a hand-written
  // list: a store added to the schema later is covered without anyone having to
  // remember this file.
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })

  // Before the reload, and load-bearing: the check that sent us here reads this
  // stamp, so a device that reloaded without it would decide it was an account
  // switch all over again, and reload forever.
  await setDataOwner(user.id, user.email)

  try {
    for (const key of PERSONAL_KEYS) localStorage.removeItem(key)
    sessionStorage.setItem(SWITCH_NOTICE_KEY, user.email)
  } catch {
    /* storage disabled: the notice is a nicety, the wipe above is the feature */
  }

  reloadOnce()
}

/**
 * Clear the device without handing it to anyone — the "I am giving this laptop
 * to someone else" button in the account menu.
 */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
  })
  try {
    for (const key of PERSONAL_KEYS) localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  reloadOnce()
}

/**
 * A reload loop would be worse than the bug: it makes the app unusable and
 * unfixable from inside itself, because the person never reaches a control. If
 * two reloads have not settled it, stop and leave them on a working (if
 * confusing) page, where the account menu can still clear things by hand.
 */
function reloadOnce(): void {
  try {
    const count = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0') + 1
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(count))
    if (count > 2) {
      console.error('genre: local reset reloaded twice without settling; not reloading again')
      return
    }
  } catch {
    /* no sessionStorage: fall through and reload anyway */
  }
  window.location.reload()
}

/** The email this device was just handed to, once, for the notice after reload. */
export function consumeSwitchNotice(): string | null {
  try {
    const email = sessionStorage.getItem(SWITCH_NOTICE_KEY)
    if (email) sessionStorage.removeItem(SWITCH_NOTICE_KEY)
    return email
  } catch {
    return null
  }
}
