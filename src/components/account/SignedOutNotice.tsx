/**
 * Tell someone their session went missing, at the moment they can still do
 * something about it.
 *
 * The failure this exists for: on 2026-08-07 Chrome came back from sleep signed
 * out while Safari, on the same machine, stayed signed in. Nothing on screen said
 * so — the sync chip rendered nothing at all while signed out — so the app looked
 * normal and kept accepting answers into a device with no account behind it.
 *
 * Note what this does NOT rely on. There is no `SIGNED_OUT` event to listen for:
 * the session was already gone when the app started, and an event that fired
 * while the tab was closed is an event nobody heard. The signal is instead
 * "Supabase is configured, the session lookup has finished, there is no user, and
 * this device remembers having had an account" — see `supabase/accountMemory.ts`.
 * A first-time guest has no marker and is never shown this, because being a guest
 * is a choice, not a fault.
 *
 * Dismissal is kept in sessionStorage on purpose: choosing "continue without an
 * account" should not nag for the rest of the afternoon, but it also should not
 * silently persist into next week. A new browser session asks again.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useSupabaseSession } from '../../lib/supabase/session'
import { rememberedAccount } from '../../lib/supabase/accountMemory'
import { openAccountDialog } from './dialogStore'
import { useLocale } from '../../lib/i18n/LocaleContext'

const ACK_KEY = 'genre.signedOutAck'

function readAck(): boolean {
  try {
    return sessionStorage.getItem(ACK_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The modal and the banner are two components reading one decision, so the
 * acknowledgement lives in a store rather than in either one's state. Same
 * `useSyncExternalStore` shape as `dialogStore` and the sync engine.
 */
let dismissed = readAck()
const subscribers = new Set<() => void>()

function setDismissed(next: boolean): void {
  dismissed = next
  try {
    if (next) sessionStorage.setItem(ACK_KEY, '1')
    else sessionStorage.removeItem(ACK_KEY)
  } catch {
    /* storage disabled — the notice reappears, which is the safe way to fail */
  }
  for (const cb of subscribers) cb()
}

function useDismissed(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => dismissed,
    () => false,
  )
}

/** True when this device had an account and now has no session. */
function useSessionLost(): boolean {
  const { configured, ready, user } = useSupabaseSession()
  return configured && ready && !user && rememberedAccount() !== null
}

export function SignedOutNotice() {
  const lost = useSessionLost()
  const isDismissed = useDismissed()
  const { t } = useLocale()

  // Signing back in clears the acknowledgement, so a session lost again later in
  // the same browser session is announced rather than arriving pre-dismissed.
  useEffect(() => {
    if (!lost && dismissed) setDismissed(false)
  }, [lost])

  if (!lost || isDismissed) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">{t('account.signedOutTitle')}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('account.signedOutBody')}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('account.continueWithout')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissed(true)
              openAccountDialog('signin')
            }}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {t('account.signBackIn')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The standing reminder after "continue without an account" is chosen.
 *
 * Only for someone whose session went missing, never for a plain guest: the sync
 * chip already reads "On this device only" for everyone signed out, and a guest
 * who never wanted an account does not need a second, larger copy of that.
 */
export function LocalOnlyBanner() {
  const lost = useSessionLost()
  const isDismissed = useDismissed()
  const { t } = useLocale()

  if (!lost || !isDismissed) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 print:hidden">
      <span>{t('account.localOnlyBanner')}</span>
      <button
        type="button"
        onClick={() => openAccountDialog('signin')}
        className="ml-2 font-medium underline underline-offset-2"
      >
        {t('account.signBackIn')}
      </button>
    </div>
  )
}
