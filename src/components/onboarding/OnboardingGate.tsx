/**
 * The first-run gate: nobody researches into an unscoped void.
 *
 * Until 2026-08 the app silently minted an 'Untitled project' on first load,
 * which is how every worksheet in the Psalms workshop became indistinguishable.
 * Now a brand-new install must choose: join a team with a code, or start a new
 * project scoped to a Culture in a Language ("Common USA genres in American
 * English"). The culture/language pair composes the default project name and is
 * stored on the project row itself.
 *
 * Visibility is a live query on `db.projects.count()`: the gate exists only
 * while the device holds no project at all, and dismisses itself the moment a
 * row lands from ANY source — the Start panel here, a team join's pull, or the
 * sync engine pulling a signed-in account's work. ActiveContextProvider
 * re-resolves on the same signal, so dismissal always yields a usable screen.
 *
 * Invariant this component leans on: in src/, only createScopedProject and the
 * sync pull/merge path create project rows (importWork copies containers, never
 * projects). A new creator would bypass this gate — don't add one.
 *
 * Suppressed on /teams/join: a join deep-link IS the "join a team" path, and
 * JoinTeam owns the join → pull → switch ordering end to end.
 *
 * The pathname comes from React Router's useLocation(), never window.location:
 * the router mounts under BASE_URL (/genre-research-app/ in production), so the
 * raw pathname would only match in dev and the suppression would fail live.
 *
 * DOM contract with scripts/check-team-live.mjs: the root carries
 * `data-onboarding-gate`, the Start panel inputs are #onboard-culture and
 * #onboard-language, the chooser button says "Start a new project", the submit
 * button says "Start". Keep these stable or update the harness with them.
 */
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/storage/db'
import { createScopedProject } from '../../lib/storage/appState'
import { composeProjectName } from '../../lib/team/scope'
import { useActiveContext } from '../ActiveContextProvider'
import { useLocale } from '../../lib/i18n/LocaleContext'
import { useSupabaseSession } from '../../lib/supabase/session'
import { openAccountDialog } from '../account/dialogStore'
import { OneCodeJoin } from '../team/OneCodeJoin'

/**
 * True once the device holds at least one project, i.e. onboarding is behind
 * us. Layout uses this to hold the app tour back until the gate is gone
 * (`undefined` — the query still resolving — reads as "not yet", so the tour
 * never races the gate).
 */
export function useOnboardingComplete(): boolean {
  const count = useLiveQuery(() => db.projects.count())
  return (count ?? 0) > 0
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

const PANEL = 'mx-auto flex w-full max-w-md flex-col gap-3'
const BIG_CHOICE =
  'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-left hover:border-sky-400 hover:bg-sky-50'
const FIELD = 'w-full rounded border border-gray-300 px-3 py-2 text-sm'
const LINKISH = 'text-sm text-sky-700 underline hover:text-sky-900'

export function OnboardingGate() {
  const projectCount = useLiveQuery(() => db.projects.count())
  const location = useLocation()
  const { t } = useLocale()
  const { user } = useSupabaseSession()
  const { reload } = useActiveContext()
  const online = useOnline()
  const navigate = useNavigate()

  const [panel, setPanel] = useState<'choose' | 'join' | 'start'>('choose')
  const [culture, setCulture] = useState('')
  const [language, setLanguage] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  // undefined = the count query has not resolved: render nothing rather than
  // flashing the gate at every existing user on every load.
  if (projectCount === undefined || projectCount > 0) return null
  if (location.pathname === '/teams/join') return null

  const canStart = Boolean(culture.trim() && language.trim()) && !busy
  const composed = composeProjectName(t, culture, language)

  const start = async () => {
    if (!canStart) return
    setBusy(true)
    try {
      await createScopedProject(culture, language, composed)
      // The live query dismisses the gate; this re-resolve mints the starter
      // containers so the page behind it is immediately usable.
      reload()
    } finally {
      setBusy(false)
    }
  }

  const joinSignedIn = () => {
    const clean = code.trim()
    if (clean) navigate(`/teams/join?code=${encodeURIComponent(clean)}`)
  }

  return (
    <div
      data-onboarding-gate
      className="fixed inset-0 z-[2147483000] overflow-y-auto bg-gray-50 text-gray-900"
    >
      <div className="flex min-h-full flex-col justify-center px-4 py-8">
        {user && (
          <p className="mx-auto mb-4 w-full max-w-md rounded bg-sky-100 px-3 py-2 text-sm text-sky-900">
            {t('onboard.checkingCloud', { email: user.email })}
          </p>
        )}

        {panel === 'choose' && (
          <div className={PANEL}>
            <h1 className="text-xl font-semibold">{t('onboard.title')}</h1>
            <p className="text-sm text-gray-600">{t('onboard.lead')}</p>
            <button type="button" className={BIG_CHOICE} onClick={() => setPanel('join')}>
              <span className="block font-medium">{t('onboard.joinTeam')}</span>
              <span className="block text-sm text-gray-600">{t('onboard.joinTeamHint')}</span>
            </button>
            <button type="button" className={BIG_CHOICE} onClick={() => setPanel('start')}>
              <span className="block font-medium">{t('onboard.startProject')}</span>
              <span className="block text-sm text-gray-600">{t('onboard.startProjectHint')}</span>
            </button>
            {!user && (
              <button
                type="button"
                className={`${LINKISH} mt-2 text-left`}
                onClick={() => openAccountDialog('signin')}
              >
                {t('onboard.haveAccount')}
              </button>
            )}
          </div>
        )}

        {panel === 'join' && (
          <div className={PANEL}>
            <h1 className="text-lg font-semibold">{t('onboard.joinTeam')}</h1>
            {!online && <p className="text-sm text-amber-700">{t('onboard.offlineJoin')}</p>}
            {user ? (
              // Signed in: OneCodeJoin would try to CREATE an account (its whole
              // job), which dead-ends on "already registered" or, worse, makes a
              // second account and trips the ownership wipe. A signed-in session
              // joins on /teams/join, which auto-joins from ?code.
              <>
                <label className="text-sm text-gray-700" htmlFor="onboard-join-code">
                  {t('onboard.enterCode')}
                </label>
                <input
                  id="onboard-join-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') joinSignedIn()
                  }}
                  placeholder="summit-…"
                  className={FIELD}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!code.trim()}
                  onClick={joinSignedIn}
                  className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {t('onboard.join')}
                </button>
              </>
            ) : (
              <>
                <OneCodeJoin />
                <button
                  type="button"
                  className={`${LINKISH} text-left`}
                  onClick={() => openAccountDialog('signin')}
                >
                  {t('onboard.signInInstead')}
                </button>
              </>
            )}
            <button
              type="button"
              className={`${LINKISH} text-left`}
              onClick={() => setPanel('choose')}
            >
              {t('onboard.back')}
            </button>
          </div>
        )}

        {panel === 'start' && (
          <div className={PANEL}>
            <h1 className="text-lg font-semibold">{t('onboard.startProject')}</h1>
            <label className="text-sm text-gray-700" htmlFor="onboard-culture">
              {t('onboard.cultureLabel')}
            </label>
            <input
              id="onboard-culture"
              value={culture}
              onChange={(e) => setCulture(e.target.value)}
              placeholder={t('onboard.culturePlaceholder')}
              className={FIELD}
              maxLength={40}
              autoFocus
            />
            <label className="text-sm text-gray-700" htmlFor="onboard-language">
              {t('onboard.languageLabel')}
            </label>
            <input
              id="onboard-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder={t('onboard.languagePlaceholder')}
              className={FIELD}
              maxLength={40}
            />
            {canStart && (
              <p className="text-sm text-gray-600">
                {t('onboard.namePreview', { name: composed })}
              </p>
            )}
            <p className="text-xs text-gray-500">{t('onboard.changeLater')}</p>
            <button
              type="button"
              disabled={!canStart}
              onClick={() => void start()}
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {t('onboard.start')}
            </button>
            <button
              type="button"
              className={`${LINKISH} text-left`}
              onClick={() => setPanel('choose')}
            >
              {t('onboard.back')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
