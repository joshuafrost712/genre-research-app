import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { NavShell } from './NavShell'
import { ContextBar } from './ContextBar'
import { AccountButton } from './AccountButton'
import { BetaSignIn } from './beta/BetaSignIn'
import { BetaWelcome } from './beta/BetaWelcome'
import { FeedbackHighlight } from './feedback/FeedbackHighlight'
import { GenreNameProvider } from './GenreNameProvider'
import { QuickJot } from './QuickJot'
import { Tour } from './tour/TourProvider'
import { APP_TOUR, APP_TOUR_STEPS } from './tour/tours'
import { DevFeedbackRoot } from '../devfeedback/DevFeedbackRoot'
import { isBetaMode } from '../devfeedback/enabled'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useLocale } from '../lib/i18n/LocaleContext'

/**
 * App shell: a persistent sidebar on wide screens, a slide-over drawer on mobile.
 * The drawer keeps "open menu -> section -> subsection" to three taps on a phone.
 */
export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { locale } = useLocale()

  // Keying the shell on the locale remounts the page tree when the language
  // changes. The loader reads the active locale from module state (see
  // lib/i18n/activeLocale.ts), which React cannot subscribe to, so without this a
  // component that does not itself consume the locale context would keep showing
  // the previous language until something else re-rendered it. Language switching
  // is rare and deliberate, so a remount is the cheap, provably-correct option;
  // focusing the switcher blurs any open field first, which flushes AutosaveText.
  return (
    <GenreNameProvider>
    <Tour id={APP_TOUR} steps={APP_TOUR_STEPS} />
    <BetaWelcome />
    <FeedbackHighlight />
    <div key={locale} className="flex h-dvh flex-col bg-gray-50 text-gray-900">
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 print:hidden">
        <button
          type="button"
          className="rounded p-2 hover:bg-gray-100 lg:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <span className="block h-0.5 w-5 bg-gray-700" />
          <span className="mt-1 block h-0.5 w-5 bg-gray-700" />
          <span className="mt-1 block h-0.5 w-5 bg-gray-700" />
        </button>
        <Link to="/" className="font-semibold">
          Local Genres Research
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <ContextBar />
          <LanguageSwitcher />
          {isBetaMode() ? <BetaSignIn /> : <AccountButton />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-gray-200 bg-white lg:block print:hidden">
          <NavShell />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-20 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
              <NavShell onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <Outlet />
          </div>
        </main>
      </div>
      <div className="print:hidden">
        <QuickJot />
        <DevFeedbackRoot />
      </div>
    </div>
    </GenreNameProvider>
  )
}
