/**
 * The drift warning: you are on a team, and this is not it.
 *
 * The failure it catches is quiet and expensive. Every browser mints its own
 * starter worksheet on first run, so somebody who works for twenty minutes before
 * joining their team, or who joins on the phone and then opens the laptop, ends up
 * typing into a private copy that looks identical to the team's. Their answers
 * save, sync, and reach nobody. At a workshop that is a morning of work that never
 * arrives.
 *
 * Warn, never move them. Joshua's call, and it is the safe one: an automatic
 * switch would be indistinguishable from the app losing their work, and it could
 * fire while somebody is deliberately drafting on their own.
 *
 * Not dismissible either. Being unmissable is the entire function.
 */
import { useTeam } from './TeamProvider'
import { switchToProject } from '../lib/sync/adopt'
import { syncEngine } from '../lib/sync/engine'
import { useActiveContext } from './ActiveContextProvider'
import { useLocale } from '../lib/i18n/LocaleContext'
import { describeMembers } from '../lib/team/describe'
import { useState } from 'react'

export function TeamBanner() {
  const { ready, current, otherTeams, refresh } = useTeam()
  const { reload } = useActiveContext()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)

  // Only when there is a real team to point at, meaning one with somebody else in
  // it. Two reasons this filter matters more than it looks. Somebody who has never
  // joined a team is not drifting, and a banner on every page would be noise they
  // learn to ignore before the day they need to read it. And on the live project
  // 25 of 27 published worksheets have exactly one member — people shared their
  // own instead of joining — so without the filter most users would be told to go
  // "open" another solo worksheet of their own.
  const realTeams = otherTeams.filter((t) => t.memberCount > 1)
  const shared = current?.shared && current.memberCount > 1
  if (!ready || !current || shared || realTeams.length === 0) return null

  const open = async (projectId: string) => {
    setBusy(true)
    try {
      await switchToProject(projectId)
      reload()
      syncEngine.syncNow()
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2">
        <span>
          <span className="font-semibold">{t('team.driftTitle')}</span>{' '}
          {t('team.driftBody')}
        </span>
        {realTeams.map((team) => (
          <button
            key={team.projectId}
            type="button"
            onClick={() => open(team.projectId)}
            disabled={busy}
            className="rounded bg-amber-800 px-2 py-1 text-xs font-medium text-white hover:bg-amber-900 disabled:opacity-50"
          >
            {t('team.driftOpen', {
              name: team.named ? team.name : `${t('team.nameless')} (${describeMembers(team.memberCount)})`,
            })}
          </button>
        ))}
      </div>
    </div>
  )
}
