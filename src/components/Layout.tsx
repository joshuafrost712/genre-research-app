import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { NavShell } from './NavShell'
import { ContextBar } from './ContextBar'
import { AccountMenu } from './AccountMenu'
import { SyncChip } from './SyncChip'
import { AccountDialog } from './account/AccountDialog'
import { SignedOutNotice, LocalOnlyBanner } from './account/SignedOutNotice'
import { StorageWarning } from './account/StorageWarning'
import { DeviceOwnerNotice } from './account/DeviceOwnerNotice'
import { OverwriteToast } from './OverwriteToast'
import { TeamChip } from './TeamChip'
import { TeamBanner } from './TeamBanner'
import { BetaWelcome } from './beta/BetaWelcome'
import { FeedbackHighlight } from './feedback/FeedbackHighlight'
import { GenreNameProvider } from './GenreNameProvider'
import { QuickJot } from './QuickJot'
import { Tour } from './tour/TourProvider'
import { APP_TOUR, APP_TOUR_STEPS } from './tour/tours'
import { OnboardingGate, useOnboardingComplete } from './onboarding/OnboardingGate'
import { DevFeedbackRoot } from '../devfeedback/DevFeedbackRoot'
import { LanguageSwitcher } from './LanguageSwitcher'
import { useLocale } from '../lib/i18n/LocaleContext'

/**
 * App shell: a persistent sidebar on wide screens, a slide-over drawer on mobile.
 * The drawer keeps "open menu -> section -> subsection" to three taps on a phone.
 */
export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { locale, t } = useLocale()
  const onboarded = useOnboardingComplete()
  const { pathname } = useLocation()
  // The app tour auto-opens on mount whenever it is unseen (TourProvider), with
  // no idea what it is opening over. Two moments it must not fire: while the
  // onboarding gate is up (first project not yet created), and mid-join on
  // /teams/join — the first project row lands there DURING the join, and the
  // tour would open on top of the ImportWork decision. Mounting late = opening
  // late; unmounting resets nothing, so an unseen tour still opens on the next
  // ordinary route.
  const tourAllowed = onboarded && pathname !== '/teams/join'

  // Keying the shell on the locale remounts the page tree when the language
  // changes. The loader reads the active locale from module state (see
  // lib/i18n/activeLocale.ts), which React cannot subscribe to, so without this a
  // component that does not itself consume the locale context would keep showing
  // the previous language until something else re-rendered it. Language switching
  // is rare and deliberate, so a remount is the cheap, provably-correct option;
  // focusing the switcher blurs any open field first, which flushes AutosaveText.
  return (
    <GenreNameProvider>
    <OnboardingGate />
    {tourAllowed && <Tour id={APP_TOUR} steps={APP_TOUR_STEPS} />}
    <BetaWelcome />
    <AccountDialog />
    <SignedOutNotice />
    <FeedbackHighlight />
    <div key={locale} className="flex h-dvh flex-col bg-gray-50 text-gray-900">
      {/* First, and above the team banner: "this browser may delete your work" is
          the most urgent thing the app can say, and it is the one thing nobody
          told the participant who lost a session's notes in Bali. */}
      <StorageWarning />
      <LocalOnlyBanner />
      <DeviceOwnerNotice />
      <TeamBanner />
      {/* Two rows on a phone, one on a laptop.
          At 390px a single row could not hold the brand, the team, the passage ×
          genre, sync, language and the account menu: the passage and genre were
          silently squeezed out of existence, which is the opposite of the point.
          Both must be legible on the device most of the workshop actually uses, so
          narrow screens get a dedicated context strip and the brand stops wrapping
          to three lines. */}
      <header className="border-b border-gray-200 bg-white print:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            className="shrink-0 rounded p-2 hover:bg-gray-100 lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <span className="block h-0.5 w-5 bg-gray-700" />
            <span className="mt-1 block h-0.5 w-5 bg-gray-700" />
            <span className="mt-1 block h-0.5 w-5 bg-gray-700" />
          </button>
          <Link to="/" className="min-w-0 truncate font-semibold">
            Local Genres Research
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {/* Before the sync chip: "which team" is a more urgent question than
                "is it saved", and it is the one nothing used to answer. */}
            <TeamChip className="hidden sm:flex" />
            <ContextBar className="hidden sm:flex" />
            <SyncChip />
            <LanguageSwitcher />
            <AccountMenu />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-1.5 sm:hidden">
          <TeamChip />
          <ContextBar />
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
        <OverwriteToast />
        <DevFeedbackRoot />
      </div>
    </div>
    </GenreNameProvider>
  )
}
