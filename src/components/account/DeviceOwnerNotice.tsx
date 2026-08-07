/**
 * Saying out loud whose work is on this device.
 *
 * Two banners, both answering questions the app previously left to guesswork.
 *
 * The first fires once, after an account switch has wiped the device, because an
 * app that silently empties itself is indistinguishable from an app that has lost
 * your work. Someone who watched a colleague's worksheets vanish deserves to be
 * told that they went nowhere: they are in that colleague's account, and this
 * screen is empty on purpose.
 *
 * The second exists because of a hole we chose to leave. Deliberate sign-out
 * KEEPS local work, so signing out and back in as yourself resumes where you
 * were. The cost is that a signed-out device still shows the last person's
 * worksheets to whoever picks it up. Rather than wipe on sign-out and cost people
 * their offline work, the device says whose work it is holding and offers the
 * button that clears it. This is the protocol's "absence is not a status" rule
 * applied to a device rather than a sync state: the thing that explains the
 * situation is also the thing that fixes it.
 */
import { useEffect, useState } from 'react'
import { useSupabaseSession } from '../../lib/supabase/session'
import { rememberedAccount } from '../../lib/supabase/accountMemory'
import { getDataOwner } from '../../lib/storage/owner'
import { clearLocalData, consumeSwitchNotice } from '../../lib/storage/reset'
import { openAccountDialog } from './dialogStore'
import { useLocale } from '../../lib/i18n/LocaleContext'

export function DeviceOwnerNotice() {
  const { configured, ready, user } = useSupabaseSession()
  const { t } = useLocale()
  const [switchedTo, setSwitchedTo] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null)

  useEffect(() => {
    setSwitchedTo(consumeSwitchNotice())
  }, [])

  useEffect(() => {
    let active = true
    void getDataOwner().then((o) => {
      if (active) setOwnerEmail(o.email ?? null)
    })
    return () => {
      active = false
    }
  }, [user])

  if (switchedTo) {
    return (
      <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-xs text-emerald-900 print:hidden">
        <span>{t('account.switchedTo', { email: switchedTo })}</span>
        <button
          type="button"
          onClick={() => setSwitchedTo(null)}
          className="ml-2 font-medium underline underline-offset-2"
        >
          {t('account.dismiss')}
        </button>
      </div>
    )
  }

  // Only for a DELIBERATE sign-out with work left behind. A session that was
  // dropped rather than ended still has its `lastAccountEmail` marker, and
  // SignedOutNotice/LocalOnlyBanner already speak for that case — two banners
  // saying overlapping things would teach people to ignore both.
  const handedOver =
    configured && ready && !user && rememberedAccount() === null && Boolean(ownerEmail)
  if (!handedOver) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 print:hidden">
      <span>{t('account.deviceHolds', { email: ownerEmail! })}</span>
      <button
        type="button"
        onClick={() => openAccountDialog('signin')}
        className="ml-2 font-medium underline underline-offset-2"
      >
        {t('account.signBackIn')}
      </button>
      <button
        type="button"
        onClick={() => {
          const ok = window.confirm(
            `This removes ${ownerEmail}'s worksheets from this browser.\n\n` +
              'Anything that finished syncing is safe in their account and comes back when they sign in. ' +
              'Anything never synced is gone for good.\n\nClear this device?',
          )
          if (ok) void clearLocalData()
        }}
        className="ml-3 font-medium underline underline-offset-2"
      >
        {t('account.clearDevice')}
      </button>
    </div>
  )
}
