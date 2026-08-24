/**
 * The soft backfill for projects that predate the onboarding gate: existing
 * users are never gated, but their active project has no culture/language, so
 * this card asks for them once, dismissibly, on the Dashboard.
 *
 * Guards, each load-bearing:
 *  - only when the active project has neither culture nor language;
 *  - only for the owner of a shared team (or any solo project) — without the
 *    role gate every joiner of an unscoped team would be prompted, and two
 *    members saving different values would LWW-flap the shared row;
 *  - dismissal is a meta flag, per project PER DEVICE (meta is deliberately
 *    not replicated), so the card may reappear on the person's other devices.
 *
 * The Team page's ProjectScopeFields stays the permanent editing surface;
 * this card is only the invitation.
 */
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/storage/db'
import { isNamedProject, setMetaValue } from '../../lib/storage/appState'
import { composeProjectName, setTeamScope } from '../../lib/team/scope'
import { useActiveContext } from '../ActiveContextProvider'
import { useTeam } from '../TeamProvider'
import { useLocale } from '../../lib/i18n/LocaleContext'

const dismissKey = (projectId: string) => `scopePromptDismissed:${projectId}`
const FIELD = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

export function ScopeBackfillCard() {
  const { ctx } = useActiveContext()
  const { current, ready, rename } = useTeam()
  const { t } = useLocale()
  const projectId = ctx?.projectId

  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )
  const dismissed = useLiveQuery(
    async () => (projectId ? Boolean(await db.meta.get(dismissKey(projectId))) : undefined),
    [projectId],
  )

  const [culture, setCulture] = useState('')
  const [language, setLanguage] = useState('')
  const [alsoRename, setAlsoRename] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!projectId || !project || dismissed !== false || !ready) return null
  if ((project.culture ?? '').trim() || (project.language ?? '').trim()) return null
  // A member of someone else's team must not be pushed to declare the team's
  // scope; the owner (or a solo worker) is the right person to answer.
  if (current?.shared && current.role !== 'owner') return null

  const canSave = Boolean(culture.trim() && language.trim()) && !busy
  const composed = composeProjectName(t, culture, language)
  const offerRename = !isNamedProject(current?.named ? current.name : project.name)

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      await setTeamScope(projectId, culture, language)
      if (offerRename && alsoRename) {
        // renameTeam under the hood: server-first for a shared project, so an
        // offline rename fails visibly instead of diverging the two names.
        await rename(composed)
      }
      await setMetaValue(dismissKey(projectId), '1')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const later = () => void setMetaValue(dismissKey(projectId), '1')

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-3">
      <h2 className="text-sm font-semibold text-sky-900">{t('scope.promptTitle')}</h2>
      <p className="mt-0.5 text-xs text-sky-900/80">{t('scope.promptBody')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-gray-700">
          {t('scope.cultureLabel')}
          <input
            value={culture}
            onChange={(e) => setCulture(e.target.value)}
            placeholder={t('onboard.culturePlaceholder')}
            maxLength={40}
            className={FIELD}
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-gray-700">
          {t('scope.languageLabel')}
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder={t('onboard.languagePlaceholder')}
            maxLength={40}
            className={FIELD}
          />
        </label>
      </div>
      {offerRename && canSave && (
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={alsoRename}
            onChange={(e) => setAlsoRename(e.target.checked)}
          />
          {t('scope.alsoRename', { name: composed })}
        </label>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void save()}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? '…' : t('scope.save')}
        </button>
        <button
          type="button"
          onClick={later}
          disabled={busy}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          {t('scope.later')}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </section>
  )
}
