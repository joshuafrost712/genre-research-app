import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { findNode, nextNavId, prevNavId, routeForSub, splitStageTitle } from '../lib/content/loader'
import { resolveGenreTokens, useNameTokens } from './GenreNameProvider'
import { useLocale } from '../lib/i18n/LocaleContext'

/**
 * Move between subsections, forwards and back.
 *
 * Until workshop feedback on 2026-08-25 the worksheet only moved forwards: every
 * section footer had `Next`, and going back meant the sidebar — which on a phone
 * is behind the hamburger, i.e. exactly where someone who has lost their place
 * will not look. "We keep losing our way a bit" is what that costs.
 *
 * So back is offered twice: `BackLink` sits under the section title, where you
 * are when you realise you want the previous section, and `SectionNav` puts a
 * Back button in the footer beside Next, where the forward habit already lives.
 * Both derive the target from `prevNavId`, so the recommended path is stated once
 * in `journeyOrder()` and no page hard-codes its neighbours.
 *
 * Going back is safe to do at any moment: answers autosave (AutosaveText flushes
 * on blur, and a button click blurs first), and entries are upserts keyed by node
 * id, so revisiting a section re-hydrates it rather than duplicating it.
 */

/** The label of a subsection, with `{genre}`/`{passage}` resolved. */
function useSubLabel(subId: string | null): string {
  const names = useNameTokens()
  if (!subId) return ''
  return resolveGenreTokens(findNode(subId)?.node.label, names)
}

/**
 * The compact back link that belongs directly above a section's title.
 * Renders nothing at the start of the journey, or for a node off the path.
 */
export function BackLink({ currentId }: { currentId: string }) {
  const prevId = prevNavId(currentId)
  const label = useSubLabel(prevId)
  if (!prevId) return null
  return (
    <Link
      to={routeForSub(prevId)}
      data-section-nav="back-top"
      className="-mt-0.5 mb-1 inline-block max-w-full truncate text-sm text-gray-500 hover:underline"
    >
      ← {label}
    </Link>
  )
}

/**
 * A section's footer navigation row: whatever page-specific links the page passes
 * as children on the left, Back and Next on the right.
 */
export function SectionNav({
  currentId,
  children,
}: {
  currentId: string
  children?: ReactNode
}) {
  const { t } = useLocale()
  const prevId = prevNavId(currentId)
  const nextId = nextNavId(currentId)
  const prevLabel = useSubLabel(prevId)
  const nextLabel = useSubLabel(nextId)
  // The full label does not fit beside Next on a 390px phone, so narrow screens
  // get the stage chip ("2b") and wider ones the whole title. Screen readers get
  // the full label either way.
  const prevChip = prevLabel ? splitStageTitle(prevLabel)[0] : ''

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-4">
      <div className="flex items-center gap-4">{children}</div>
      {/* ml-auto, so that when the row wraps on a narrow screen the pair stays
          together on the right rather than sliding under the left-hand links. */}
      <div className="ml-auto flex items-center gap-2">
        {prevId && (
          <Link
            to={routeForSub(prevId)}
            data-section-nav="back"
            aria-label={`${t('nav.back')}: ${prevLabel}`}
            className="whitespace-nowrap rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← <span className="sm:hidden">{prevChip}</span>
            <span className="hidden sm:inline">{prevLabel}</span>
          </Link>
        )}
        {nextId ? (
          <Link
            to={routeForSub(nextId)}
            data-section-nav="next"
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            {t('nav.next')}: {nextLabel} →
          </Link>
        ) : (
          <span className="text-sm text-gray-400">{t('nav.endOfWorksheet')}</span>
        )}
      </div>
    </div>
  )
}
