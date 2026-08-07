/**
 * Tiny external store for the account dialog, so the header menu and the beta
 * welcome can both open it without threading state through the layout. Same
 * `useSyncExternalStore` shape the sync engine already uses.
 */
import { useSyncExternalStore } from 'react'

/**
 * `forgot` asks for the reset email; `recover` is where someone lands after
 * following the link in it, to choose the new password. They are separate modes
 * because they happen on different days, on possibly different devices, and only
 * the second one has a session behind it.
 */
export type AccountDialogMode = 'signin' | 'create' | 'forgot' | 'recover'

let mode: AccountDialogMode | null = null
const subscribers = new Set<() => void>()

function emit(): void {
  for (const cb of subscribers) cb()
}

export function openAccountDialog(next: AccountDialogMode): void {
  mode = next
  emit()
}

export function closeAccountDialog(): void {
  mode = null
  emit()
}

/**
 * Open the dialog straight from a link: `?signup=1` or `?signin=1`.
 *
 * The invite email can then point at account creation directly, instead of asking
 * people to find a header control — which is the step that failed the first time
 * round. The parameter is stripped afterwards so a refresh, or a link someone
 * bookmarked, does not keep reopening the dialog over their work.
 *
 * Runs at module load, before React first reads the store.
 */
function applyUrlOverride(): void {
  try {
    const q = new URLSearchParams(window.location.search)
    const wanted: AccountDialogMode | null = q.has('signup')
      ? 'create'
      : q.has('signin')
        ? 'signin'
        : null
    if (!wanted) return
    mode = wanted
    q.delete('signup')
    q.delete('signin')
    const query = q.toString()
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    )
  } catch {
    /* no window/history — ignore */
  }
}

applyUrlOverride()

export function useAccountDialog(): AccountDialogMode | null {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => mode,
    () => null,
  )
}
