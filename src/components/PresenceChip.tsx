/**
 * "2 here now" in the header: how many teammates are in this worksheet with you.
 *
 * DELIBERATELY WORDED APART FROM TeamChip, which is the risk this component was
 * written to avoid. TeamChip's "4 people" is a ten-second Postgres poll of who
 * BELONGS to the team; this is a live count of who is PRESENT. Two adjacent
 * numbers that look alike and mean different things would make the header harder
 * to read, not easier, so one says "people" and the other says "here now".
 *
 * Renders nothing when you are alone, and that is not the "absence is not a
 * status" mistake. A sync chip's blank hid a real problem the person needed to act
 * on; nobody else being in the worksheet is not a problem, it is Tuesday. "0 here
 * now" beside "4 people" would be a permanent piece of furniture saying nothing.
 */
import { usePresence } from './PresenceProvider'
import { useLocale } from '../lib/i18n/LocaleContext'

export function PresenceChip({ className = '' }: { className?: string }) {
  const { people, nameOf } = usePresence()
  const { t } = useLocale()

  if (people.length === 0) return null

  // Names in the title, not on the chip. Same reasoning as TeamChip: the chip has
  // to keep its width whoever is in the room, and at 390px four names would either
  // wrap the header or truncate to nothing.
  const names = people.map((p) => nameOf(p.userId)).join(', ')

  return (
    <span
      title={t('presence.who', { names })}
      className={`flex shrink-0 items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ${className}`}
    >
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-emerald-500" />
      {t('presence.here', { n: people.length })}
    </span>
  )
}
