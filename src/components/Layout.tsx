import { useCallback, useState } from 'react'
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
import { PresenceChip } from './PresenceChip'
import { PresenceProvider } from './PresenceProvider'
import { BetaWelcome } from './beta/BetaWelcome'
import { FeedbackHighlight } from './feedback/FeedbackHighlight'
import { GenreNameProvider } from './GenreNameProvider'
import { QuickJot } from './QuickJot'
import { JotNotesProvider } from './blocks/JotPicker'
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

  // Bumped by either ContextBar when someone deliberately switches passage or
  // genre; keys the page tree below, so per-genre local state starts clean.
  // See the keyed div around <Outlet/> for why it is a counter and not the
  // context itself.
  const [switchSeq, setSwitchSeq] = useState(0)
  const onSwitched = useCallback(() => setSwitchSeq((n) => n + 1), [])

  // Keying the shell on the locale remounts the page tree when the language
  // changes. The loader reads the active locale from module state (see
  // lib/i18n/activeLocale.ts), which React cannot subscribe to, so without this a
  // component that does not itself consume the locale context would keep showing
  // the previous language until something else re-rendered it. Language switching
  // is rare and deliberate, so a remount is the cheap, provably-correct option;
  // focusing the switcher blurs any open field first, which flushes AutosaveText.
  return (
    // Outside the shell, so the sidebar's per-tab dots and the header's count come
    // from ONE subscription. Two mounts would mean two websockets and two slightly
    // different ideas of who is in the room, which is the failure TeamProvider
    // already exists to prevent — with a socket attached to each copy.
    <PresenceProvider>
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
            <ContextBar className="hidden sm:flex" onSwitched={onSwitched} />
            <SyncChip />
            {/* After the sync chip, not beside TeamChip, and that placement is the
                mitigation for this feature's own worst risk: "4 people" (who belong)
                and "2 here now" (who are present) mean different things, so they must
                not sit adjacent looking like a pair. */}
            <PresenceChip className="hidden sm:flex" />
            <LanguageSwitcher />
            <AccountMenu />
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-1.5 sm:hidden">
          <TeamChip />
          <ContextBar onSwitched={onSwitched} />
          <PresenceChip className="ml-auto" />
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

        {/* The deep bottom padding is not decoration. Quick-jot sits fixed at
            bottom-right for everyone, and the feedback FAB at bottom-left for
            beta testers, so without room to scroll past the end of the page
            they cover whatever the last row is — which is now the Back/Next
            nav. Checked at 390px by scripts/check-back-nav.mjs. */}
        <main className="flex-1 overflow-y-auto px-4 pb-24 pt-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            {/* One shared live query feeds every answer box's Insert-a-jot
                button, on every page that renders blocks (worksheet, wizard,
                choose-genre, style-compare). */}
            <JotNotesProvider>
              {/* Remount the page on a deliberate passage/genre switch, so any
                  per-genre local state starts clean. Blurring the focused field
                  (ContextBar.switchTo) is what actually prevents a half-typed
                  answer landing in the wrong genre; this is the belt to that
                  brace, for local state nobody has thought about yet.

                  A COUNTER, not the context itself: ctx starts null and resolves
                  a moment later, so keying on its identity would remount every
                  page once on every cold load, for nothing.

                  Inside JotNotesProvider and around the Outlet only. The
                  provider holds one project-scoped jot query shared by every
                  page, and remounting it re-runs that query for nothing; keying
                  the outer locale div would be worse still, since it contains
                  the header, so ContextBar would unmount mid-click.

                  /capture opts out: it debounce-saves its draft into meta on a
                  400ms timer, and a remount inside that window drops the last
                  keystrokes. It holds no genre-scoped answers, so there is
                  nothing here for it to gain. */}
              <div key={pathname === '/capture' ? 'capture' : switchSeq}>
                <Outlet />
              </div>
            </JotNotesProvider>
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
    </PresenceProvider>
  )
}
