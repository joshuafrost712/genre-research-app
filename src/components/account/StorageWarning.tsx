/**
 * Tell a guest that the browser has not promised to keep their work, while they
 * can still do something about it.
 *
 * The failure this exists for: on 2026-08-24 a Bali workshop participant opened
 * the app from a WhatsApp link on an iPhone, typed notes on local music genres,
 * and then found the app empty. Nothing had ever suggested the work was at risk.
 *
 * The app was not short of the fact. `persist.ts` had asked the browser to keep
 * the data and had been refused, and the refusal was rendered — inside the
 * SIGNED-IN account menu, the one place a guest can never look. `SyncChip` says
 * "on this device only", which is a description of where the work is, not a
 * warning that the device may throw it away. And `LocalOnlyBanner` deliberately
 * skips plain guests, by a reasoning that was right for its own purpose and left
 * exactly this person unwarned.
 *
 * So the trigger here is the guest case specifically: no account, real work on
 * the device, and a browser that refused to promise. That combination is not
 * unusual on iOS, it is the default for any non-installed tab, which is why the
 * banner leads with the cheapest remedy (a file) rather than the one that needs
 * an email address.
 *
 * Dismissal lives in sessionStorage, following `SignedOutNotice`: acknowledging
 * it should not nag for the rest of the afternoon, and should not silently
 * persist into next week. `ephemeral` cannot be dismissed at all — at that point
 * the device has already lost something.
 */
import { useState, useSyncExternalStore } from 'react'
import { useSupabaseSession } from '../../lib/supabase/session'
import { useStorageState } from '../../lib/storage/durability'
import { saveBackupFile } from '../../lib/storage/backup'
import { openAccountDialog } from './dialogStore'
import { useLocale } from '../../lib/i18n/LocaleContext'

const ACK_KEY = 'genre.storageRiskAck'

function readAck(): boolean {
  try {
    return sessionStorage.getItem(ACK_KEY) === '1'
  } catch {
    return false
  }
}

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

/**
 * Should the storage warning be on screen right now?
 *
 * Exported because `LocalOnlyBanner` needs to stand down when it is. Both would
 * otherwise stack two amber strips saying overlapping things, and this one is
 * strictly the more informative: it carries the same "on this device only"
 * meaning plus the risk and the remedy.
 */
export function useStorageWarning(): {
  show: boolean
  ephemeral: boolean
  inAppBrowser: boolean
  configured: boolean
} {
  const { user, configured } = useSupabaseSession()
  const { risk, work, ready, inAppBrowser } = useStorageState()
  const isDismissed = useDismissed()

  const ephemeral = risk === 'ephemeral'
  // `work > 0` keeps it away from someone who has just arrived and typed nothing:
  // a warning about losing work you have not done yet is noise, and noise is what
  // gets a banner ignored on the day it matters.
  const at = ready && !user && work > 0 && risk !== 'protected'
  return { show: at && (ephemeral || !isDismissed), ephemeral, inAppBrowser, configured }
}

export function StorageWarning() {
  const { show, ephemeral, inAppBrowser, configured } = useStorageWarning()
  const { t } = useLocale()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!show) return null

  const saveBackup = async () => {
    setSaving(true)
    try {
      await saveBackupFile()
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      // A stable hook for scripts/check-storage-warning.mjs, which asserts this
      // is VISIBLE rather than merely present. Text-in-the-DOM is not the same
      // claim: the onboarding gate is a full-screen overlay, and an earlier
      // version of that check passed while the banner sat invisible underneath it.
      data-storage-warning=""
      // Amber for at-risk, red once something has actually gone. Not a decoration:
      // the second state is a report of loss, and it should not look like the
      // standing advisory a person has already learned to scroll past.
      className={`border-b px-4 py-2 text-xs print:hidden ${
        ephemeral
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
      role={ephemeral ? 'alert' : 'status'}
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center">
        <span>{t(ephemeral ? 'storage.lost' : 'storage.atRisk')}</span>
        {inAppBrowser && <span className="font-medium">{t('storage.inAppBrowser')}</span>}
        {saved ? (
          <span className="font-medium">{t('storage.saved')}</span>
        ) : (
          <button
            type="button"
            onClick={saveBackup}
            disabled={saving}
            className="font-medium underline underline-offset-2 disabled:opacity-60"
          >
            {saving ? t('storage.saving') : t('storage.saveBackup')}
          </button>
        )}
        {configured && (
          <button
            type="button"
            onClick={() => openAccountDialog('signin')}
            className="font-medium underline underline-offset-2"
          >
            {t('storage.signIn')}
          </button>
        )}
        {!ephemeral && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-amber-700 underline underline-offset-2"
          >
            {t('account.dismiss')}
          </button>
        )}
      </div>
    </div>
  )
}
