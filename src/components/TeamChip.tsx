/**
 * Which team you are in, in the header, on every page.
 *
 * This is the smallest fix for the largest complaint from the Psalms workshop:
 * people could not tell whose data they were typing into. The app knew — genres
 * and passages have always been filtered to the active project — but it never
 * said so anywhere, and an invariant nobody can see is one nobody trusts.
 *
 * Deliberately a COUNT, not a list of names. Joshua's call, and it is the right
 * one for a header: "4 people" is glanceable and stays the same width whoever is
 * on the team, while four email addresses would either wrap or be truncated to
 * uselessness on a phone. The names live one tap away on the team page.
 */
import { Link } from 'react-router-dom'
import { useTeam } from './TeamProvider'
import { useLocale } from '../lib/i18n/LocaleContext'

export function TeamChip({ className = '' }: { className?: string }) {
  const { ready, configured, current } = useTeam()
  const { t } = useLocale()

  // A build with no cloud sync has no teams to be in, and nothing here would be
  // true. Waiting for `ready` avoids flashing "not shared" at somebody who is in
  // fact on a team, which is exactly the wrong thing to flash.
  if (!configured || !ready || !current) return null

  const people = current.memberCount > 1
    ? t('team.people', { n: current.memberCount })
    : t('team.justYou')

  // Not shared is a state worth showing, not an absence. Same reasoning as the
  // sync chip's signed-out label: no chip reads as "nothing to report".
  if (!current.shared || current.memberCount <= 1) {
    return (
      <Link
        to="/teams"
        title={t('team.openTeamPage')}
        className={`flex shrink-0 items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 ${className}`}
      >
        <span className="max-w-[9rem] truncate font-medium sm:max-w-[14rem]">
          {current.shared && current.named ? current.name : t('team.solo')}
        </span>
      </Link>
    )
  }

  return (
    <Link
      to="/teams"
      title={t('team.openTeamPage')}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs text-sky-800 hover:bg-sky-100 ${className}`}
    >
      {/* The NAME gets the space on a phone; the count follows once there is room.
          Joshua's call after seeing it at 390px, and the right one: the name is
          what answers "whose data is this?", and the count is a detail the team
          page carries in full. Never the member list here, at any width. */}
      <span className="max-w-[8rem] truncate font-medium sm:max-w-[13rem]">
        {current.named ? current.name : t('team.nameless')}
      </span>
      <span className="hidden shrink-0 opacity-75 sm:inline">· {people}</span>
    </Link>
  )
}
