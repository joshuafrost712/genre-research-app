/**
 * "Priya's edit replaced your answer" — with the answer still in reach.
 *
 * Two people typing the same field at once is resolved by last-write-wins, and
 * that is the right rule for a store with one row per cell. Its cost is that the
 * loser's text vanishes from the screen with nothing said, which is the single
 * most alarming thing this app can do in a room of seven people sharing one
 * worksheet. `merge.ts` already preserves the text in `db.history`; this is what
 * turns a silent replacement into a visible event with an undo next to it.
 *
 * What reaches this component is now narrow, and it has to be. The first version
 * fired for any remote change to any answer already in this browser's copy of
 * the data, which in a team is nearly every answer, so people who had typed
 * nothing were interrupted all morning about other people's work. `merge.ts`
 * now decides collisions; this only renders them.
 *
 * Deliberately small in scope: it announces, it restores, it goes away. It is not
 * a merge UI and not a version history — those are worth building when the
 * evidence says people need them, and this is what makes the evidence visible.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeOverwrites, type OverwriteNotice } from '../lib/sync/notices'
import { restoreEntryText } from '../lib/storage/entries'
import { findNode, navTree } from '../lib/content/loader'
import { useMemberLabel } from '../lib/team/people'
import { useLocale } from '../lib/i18n/LocaleContext'
import { useActiveContext } from './ActiveContextProvider'

/** How long a notice stays up before it stops being useful and starts being noise. */
const DISMISS_MS = 12_000

/** The node's own label, for a sentence a person can act on. */
function labelFor(nodeId: string): string | null {
  const ref = findNode(nodeId)
  if (!ref) return null
  return ref.node.label ?? null
}

/**
 * The subsection route that will actually show this node.
 *
 * `/worksheet/:nodeId` takes a navigable subsection, not any node, so walk the
 * ancestors from the innermost outward and take the first that navTree lists.
 * Returns null rather than guessing when nothing matches — a View button that
 * lands on an empty page is worse than no View button.
 */
function routeFor(nodeId: string): string | null {
  const ref = findNode(nodeId)
  if (!ref) return null
  const navigable = new Set(navTree().flatMap((s) => s.subsections.map((sub) => sub.id)))
  if (navigable.has(nodeId)) return `/worksheet/${nodeId}`
  for (let i = ref.parents.length - 1; i >= 0; i--) {
    if (navigable.has(ref.parents[i].id)) return `/worksheet/${ref.parents[i].id}`
  }
  return null
}

export function OverwriteToast() {
  const [notice, setNotice] = useState<OverwriteNotice | null>(null)
  const [restored, setRestored] = useState(false)
  const { t } = useLocale()
  const navigate = useNavigate()
  const { ctx } = useActiveContext()
  const activeProjectId = ctx?.projectId

  useEffect(
    () =>
      subscribeOverwrites((n) => {
        // Only for the team you are looking at. The sync engine merges EVERY
        // project this account belongs to on the same cycle, so without this a
        // teammate editing team A pops a toast over team B's worksheet — showing
        // team A's answer text, with an Undo that writes back into team A. That is
        // the one thing a person in a workshop cannot be asked to reason about.
        if (activeProjectId && n.projectId && n.projectId !== activeProjectId) return
        // Newest wins the slot. A burst of merges is one event to a person, and a
        // stack of toasts over the worksheet would hide the work it is about.
        setRestored(false)
        setNotice(n)
      }),
    [activeProjectId],
  )

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [notice, restored])

  // Above the early return, or the hook count changes with the toast. Both
  // arguments are nullable for exactly that reason.
  const who = useMemberLabel(notice?.projectId, notice?.byAuthor)

  if (!notice) return null

  const label = labelFor(notice.nodeId)
  const route = routeFor(notice.nodeId)

  return (
    <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4 print:hidden">
      <div className="w-full max-w-md rounded-lg border border-amber-300 bg-amber-50 p-3 shadow-lg">
        <p className="text-sm text-amber-900" title={who.email ?? undefined}>
          {restored ? (
            t('overwrite.restored')
          ) : (
            <>
              {/* Naming the person is the friendlier sentence and the more
                  useful one in a room. It falls back to the anonymous wording
                  whenever the name cannot be resolved — offline, an older
                  client, a writer who is not on the member list — so the toast
                  never renders a blank where a name should be. */}
              {who.label ? t('overwrite.titleBy', { who: who.label }) : t('overwrite.title')}
              {label ? ` ${t('overwrite.where', { where: label })}` : ''}.
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          {route && (
            <button
              type="button"
              onClick={() => {
                navigate(route)
                setNotice(null)
              }}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
            >
              {t('overwrite.view')}
            </button>
          )}
          {!restored && (
            <button
              type="button"
              onClick={async () => {
                const ok = await restoreEntryText(
                  notice.entryId,
                  notice.prevText,
                  notice.prevValue,
                )
                if (ok) setRestored(true)
                else setNotice(null)
              }}
              className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-800"
            >
              {t('overwrite.undo')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-md px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-100"
          >
            {t('overwrite.dismiss')}
          </button>
        </div>
      </div>
    </div>
  )
}
