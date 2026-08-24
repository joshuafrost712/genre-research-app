/**
 * The permanent editing surface for a project's culture/language scope, on the
 * Team page under the name field. The onboarding gate and the Dashboard
 * backfill card both point here with "you can change this later".
 *
 * Autosaves on blur through setTeamScope (a local write that replicates with
 * the project row — works offline, reaches teammates through ordinary sync).
 * Copy says the scope belongs to the TEAM, not the viewer: two members editing
 * it are editing the same shared fact, last write wins.
 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/storage/db'
import { setTeamScope } from '../../lib/team/scope'
import { useTeam } from '../TeamProvider'
import { useLocale } from '../../lib/i18n/LocaleContext'

const FIELD = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

export function ProjectScopeFields() {
  const { current } = useTeam()
  const { t } = useLocale()
  const projectId = current?.projectId
  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  )
  const [culture, setCulture] = useState('')
  const [language, setLanguage] = useState('')
  const [savedAt, setSavedAt] = useState(0)

  // Seed the drafts when the row first loads or the active project changes;
  // not on every remote update, or a teammate's save would overwrite what this
  // person is mid-typing.
  useEffect(() => {
    setCulture(project?.culture ?? '')
    setLanguage(project?.language ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  if (!current || !projectId || project === undefined) return null

  const dirty =
    culture.trim() !== (project?.culture ?? '') || language.trim() !== (project?.language ?? '')

  const save = async () => {
    if (!dirty) return
    await setTeamScope(projectId, culture, language)
    setSavedAt(Date.now())
  }

  const scoped = Boolean((project?.culture ?? '').trim() || (project?.language ?? '').trim())

  return (
    <div className="mt-3">
      {scoped && (
        <p className="mb-1 text-xs text-gray-600">
          {t('scope.teamScopeHint', {
            culture: project?.culture || '—',
            language: project?.language || '—',
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-gray-600">
          {t('scope.cultureLabel')}
          <input
            value={culture}
            onChange={(e) => setCulture(e.target.value)}
            onBlur={() => void save()}
            placeholder={t('onboard.culturePlaceholder')}
            maxLength={40}
            className={FIELD}
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-gray-600">
          {t('scope.languageLabel')}
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            onBlur={() => void save()}
            placeholder={t('onboard.languagePlaceholder')}
            maxLength={40}
            className={FIELD}
          />
        </label>
      </div>
      {savedAt > 0 && !dirty && <p className="mt-1 text-xs text-green-700">{t('scope.saved')}</p>}
    </div>
  )
}
