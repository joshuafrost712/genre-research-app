/**
 * "These belong to the Walak team. Anything you add here goes to that team."
 *
 * Sits above the passage and genre lists, which is where the doubt actually
 * arises: adding a genre is the moment somebody wonders whose data they are
 * touching. The guarantee itself is old — GenreBank has always queried
 * `db.genres.where('project_id').equals(ctx.projectId)`, so another team's genres
 * are not merely hidden, they are not fetched. What was missing was saying it.
 */
import { Link } from 'react-router-dom'
import { useTeam } from '../TeamProvider'
import { useLocale } from '../../lib/i18n/LocaleContext'
import { describeMembers } from '../../lib/team/describe'

export function TeamProvenance() {
  const { ready, current } = useTeam()
  const { t } = useLocale()

  if (!ready || !current) return null

  const shared = current.shared && current.memberCount > 1
  const people = describeMembers(current.memberCount)

  return (
    <p
      className={`rounded border px-3 py-2 text-sm ${
        shared
          ? 'border-sky-200 bg-sky-50 text-sky-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      {shared
        ? t('team.belongsTo', {
            name: current.named ? current.name : t('team.nameless'),
            people,
          })
        : t('team.belongsToSolo', { people })}{' '}
      <Link to="/teams" className="whitespace-nowrap underline">
        {t('team.openTeamPage')}
      </Link>
    </p>
  )
}
