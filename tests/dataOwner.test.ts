/**
 * Deciding whether the work in this browser belongs to the person who just
 * signed in.
 *
 * This one predicate is the whole account-switch fix, and it is wrong in a
 * damaging way in both directions. Say "different person" too eagerly and the
 * app deletes work somebody just did offline. Say it too rarely and you get the
 * 2026-08-07 report: a brand-new account opened on a used laptop saw the previous
 * person's worksheets, and — worse, because it is silent and durable — the first
 * sync cycle published them into the newcomer's cloud account.
 *
 * `isDifferentPerson` is pure, so the rules can be pinned down here without a
 * browser, a database, or a Supabase session.
 */
import { describe, expect, it } from 'vitest'
import { isDifferentPerson } from '../src/lib/storage/owner'

const ADA = { uid: 'uid-ada', email: 'ada@example.org' }
const GRACE = { uid: 'uid-grace', email: 'grace@example.org' }

describe('isDifferentPerson', () => {
  it('is false for the same account signing back in', () => {
    expect(isDifferentPerson(ADA, ADA.uid, ADA.email)).toBe(false)
  })

  it('is true when another account signs in on the same device', () => {
    expect(isDifferentPerson(ADA, GRACE.uid, GRACE.email)).toBe(true)
  })

  it('treats an unclaimed device as the arriving person’s', () => {
    // The "worked offline, then signed in" path. Wiping here would throw away
    // the work they came to save, which is the opposite of the point.
    expect(isDifferentPerson({}, ADA.uid, ADA.email)).toBe(false)
  })

  it('trusts the uid over the email when both are stamped', () => {
    // Someone changed their address. Same account, same rows, no wipe.
    expect(isDifferentPerson(ADA, ADA.uid, 'ada@newjob.org')).toBe(false)
  })

  it('falls back to email when no uid is stamped', () => {
    // The migration case, live for exactly one release: devices that predate the
    // stamp carry only `lastAccountEmail`. Without this, the first sign-in after
    // the fix ships reproduces the bug on the very laptops that reported it.
    expect(isDifferentPerson({ email: ADA.email }, GRACE.uid, GRACE.email)).toBe(true)
    expect(isDifferentPerson({ email: ADA.email }, ADA.uid, ADA.email)).toBe(false)
  })

  it('compares emails case-insensitively', () => {
    expect(isDifferentPerson({ email: 'Ada@Example.ORG' }, ADA.uid, 'ada@example.org')).toBe(false)
  })

  it('does not wipe on an email-stamped device when the session has no email', () => {
    // An absent email is missing information, not evidence of a different person,
    // and destroying data on missing information is never the safe default.
    expect(isDifferentPerson({ email: ADA.email }, ADA.uid, '')).toBe(false)
  })
})
