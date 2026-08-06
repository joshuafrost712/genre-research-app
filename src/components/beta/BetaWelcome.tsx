/**
 * Beta-tester welcome. Shows once, after the app tour, only in beta mode. It
 * explains that they're testing a beta and how the comment tool works, then points
 * them at the account dialog so their feedback is tagged to them. The sign-in and
 * create-account forms themselves live in `AccountDialog`, which is reachable from
 * the header too, so there is only one of each. Degrades gracefully when Supabase
 * isn't configured: it still welcomes them and lets them comment anonymously.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { isBetaMode } from '../../devfeedback/enabled'
import { isTourSeen, getMetaValue, setMetaValue } from '../../lib/storage/appState'
import { APP_TOUR } from '../tour/tours'
import { useSupabaseSession } from '../../lib/supabase/session'
import { openAccountDialog } from '../account/dialogStore'

const SEEN_KEY = 'betaWelcomeSeen'

export function BetaWelcome() {
  const beta = isBetaMode()
  const { configured, ready, user } = useSupabaseSession()
  const appTourSeen = useLiveQuery(() => isTourSeen(APP_TOUR), [], false)
  const welcomeSeen = useLiveQuery(() => getMetaValue(SEEN_KEY), [], undefined)

  if (!beta) return null
  // Wait for the app tour to finish and for the seen-flag to load before deciding.
  if (!appTourSeen || welcomeSeen === undefined || welcomeSeen === '1') return null
  if (!ready) return null

  const dismiss = () => void setMetaValue(SEEN_KEY, '1')

  return (
    <div
      className="fixed inset-0 z-[2147483001] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-label="Welcome, beta tester"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold text-gray-900">You're testing the beta — thank you</h2>
        <p className="mt-2 text-sm text-gray-600">
          You're one of a small group giving feedback on this beta. As you use the app, tell us
          what's confusing, what's missing, or what could work better.
        </p>

        <div className="mt-4 rounded-md bg-sky-50 p-3 text-sm text-sky-900">
          <strong>How to leave feedback:</strong> highlight any text on the page, then click the{' '}
          <span className="font-medium">💬 Comment</span> button that appears (or press{' '}
          <kbd className="rounded border border-sky-200 bg-white px-1">Ctrl/Cmd+Shift+C</kbd>). Your
          notes collect in the <span className="font-medium">🛠 Feedback</span> button at the bottom
          — review them there, then send them all at once.
        </div>

        {user ? (
          <div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
            You're signed in as <strong>{user.email}</strong>. Your feedback will be tagged to you,
            so we can follow up if we have questions. You can change your password anytime from the
            account menu (top right).
          </div>
        ) : configured ? (
          <div className="mt-4">
            <p className="text-sm text-gray-700">
              Create an account so your feedback is tagged to you and we can follow up. Any email
              address works, including your work address; you do not need a Google account.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openAccountDialog('create')}
                className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
              >
                Create an account
              </button>
              <button
                type="button"
                onClick={() => openAccountDialog('signin')}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                I already have one
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Accounts aren't switched on in this build yet, so your feedback will be sent without a
            name attached. You can still comment freely.
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          {!user && configured && (
            <button type="button" onClick={dismiss} className="text-sm text-gray-500 hover:text-gray-700">
              Maybe later
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {user ? 'Start giving feedback' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
