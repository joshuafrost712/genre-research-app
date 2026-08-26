import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { setActiveFocusText, setActiveGenre, type ActiveContext } from '../lib/storage/appState'
import { useAllEntries } from '../lib/storage/entries'
import { subsectionCounts, subsectionLayers, wizardSequence, type Count } from '../lib/progress'
import { subsectionForPath } from '../lib/content/loader'
import { useActiveContext } from './ActiveContextProvider'
import { useDepthMode } from './DepthModeContext'
import { useLocale } from '../lib/i18n/LocaleContext'
import { useDismiss } from './useDismiss'
import { captureAnchor, restoreAnchor } from './useAnchoredScroll'
import type { Layer } from '../schema/types'

type Menu = 'genre' | 'passage' | null

/** How long the switched name stays tinted. Long enough to notice, not to wait for. */
const FLASH_MS = 1000

/**
 * What the worksheet is editing: active passage × genre, each one a switcher.
 *
 * This used to be a link to the genre bank, which meant that comparing two
 * genres on one question cost a trip to another page and a bounce back to the
 * top of the worksheet. Cultural insiders do not work one genre at a time —
 * they take one artistic question and move sideways across genres — so the tool
 * has to move sideways too. Switching here changes the active pair in place and
 * leaves the step alone.
 *
 * The step survives because it lives in the URL, and the context is only four
 * ids in `meta`, so a switch is a meta write plus `reload()`. No `navigate()`,
 * which is the entire point: `ChooseGenre.lockIn` already works this way.
 */
export function ContextBar({
  className = '',
  onSwitched,
}: {
  className?: string
  onSwitched?: () => void
}) {
  const { ctx, reload } = useActiveContext()
  const { mode } = useDepthMode()
  const { t } = useLocale()
  const { pathname, search } = useLocation()
  const [menu, setMenu] = useState<Menu>(null)
  const [flashed, setFlashed] = useState<'genre' | 'passage' | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = useCallback(() => setMenu(null), [])
  useDismiss(wrapRef, menu !== null, close)

  useEffect(() => () => void (flashTimer.current && clearTimeout(flashTimer.current)), [])

  const projectId = ctx?.projectId
  const genres = useLiveQuery(
    async () =>
      projectId ? await db.genres.where('project_id').equals(projectId).sortBy('name') : [],
    [projectId],
  )
  const passages = useLiveQuery(
    async () =>
      projectId ? await db.focusTexts.where('project_id').equals(projectId).toArray() : [],
    [projectId],
  )
  // Every worksheet in the project, so a candidate pair's synthesis container can
  // be looked up rather than guessed. Ids are usually `ws-<passage>-<genre>`, but
  // legacy rows carry random ids and still work, so deriving one by string
  // concatenation would silently report zero answers for the oldest projects.
  const worksheets = useLiveQuery(
    async () =>
      projectId ? await db.worksheets.where('project_id').equals(projectId).toArray() : [],
    [projectId],
  )

  const labels = useLiveQuery(async () => {
    if (!ctx) return null
    const [focusText, genre] = await Promise.all([
      db.focusTexts.get(ctx.focusTextId),
      db.genres.get(ctx.genreId),
    ])
    return { focusText: focusText?.reference ?? '—', genre: genre?.name ?? '—' }
  }, [ctx?.focusTextId, ctx?.genreId])

  // Only queried while a menu is open: closed, this resolves to [] without
  // touching the entries table.
  const entries = useAllEntries(menu ? (ctx ?? null) : null)

  // Which step are we standing on? `/wizard` is resolved here rather than in the
  // loader, because the sequence lives in lib/progress and the loader must not
  // import it back.
  const subId = useMemo(() => {
    if (pathname === '/wizard') {
      const n = Number(new URLSearchParams(search).get('step') ?? 0)
      const steps = wizardSequence(mode)
      const i = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), steps.length - 1) : 0
      return steps[i]?.subId ?? null
    }
    return subsectionForPath(pathname)
  }, [pathname, search, mode])

  const layers = useMemo(() => (subId ? subsectionLayers(subId, mode) : []), [subId, mode])

  const worksheetFor = useCallback(
    (focusTextId: string, genreId: string) =>
      worksheets?.find((w) => w.focus_text_id === focusTextId && w.genre_id === genreId)?.id ?? '',
    [worksheets],
  )

  /**
   * Counts for each row of an open menu, or null when they would be noise.
   *
   * Null in three cases, each for its own reason: no step to count (the home
   * page, the genre bank), entries still loading (dexie-react-hooks hands back
   * the PREVIOUS result across a deps change, so rendering 0/N here would show
   * a confident lie for a frame), or the step's answers do not vary along this
   * menu's axis at all — see `sharedNote`.
   */
  const counts = useMemo((): Count[] | null => {
    if (!subId || !ctx || entries === undefined) return null
    if (varies(layers, menu) === false) return null
    const ctxs =
      menu === 'genre'
        ? (genres ?? []).map((g) => candidate(ctx, ctx.focusTextId, g.id, worksheetFor))
        : (passages ?? []).map((p) => candidate(ctx, p.id, ctx.genreId, worksheetFor))
    return subsectionCounts(entries, subId, ctxs, mode)
  }, [subId, ctx, entries, layers, menu, genres, passages, mode, worksheetFor])

  /** The line that replaces a column of identical numbers. */
  const sharedNote = useMemo(() => {
    if (!subId || !menu || varies(layers, menu) !== false) return null
    return menu === 'genre' ? t('context.sharedAcrossGenres') : t('context.sharedAcrossPassages')
  }, [subId, menu, layers, t])

  const switchTo = async (kind: 'genre' | 'passage', id: string) => {
    if (!ctx) return

    // LOAD-BEARING, not defensive. AutosaveText keeps keystrokes in local state
    // and writes them on blur, and its onBlur closure is rebound every render.
    // On Safari, tapping a button does not blur a focused input (JotPicker
    // carries this same guard for the same reason), so without this the blur
    // fires AFTER the context has changed and files the draft under the genre
    // you just switched to. Blurring first makes flush() run against the old
    // context, which upsertEntry reads by value.
    const el = document.activeElement
    if (el instanceof HTMLElement) el.blur()

    const anchor = captureAnchor()
    setMenu(null)

    // The meta key only. Deliberately NOT ensureWorksheetFor: that writes a row
    // and calls trackUpsert, so merely opening a menu would push worksheets to
    // sync. reload() creates the worksheet if this pair is new.
    if (kind === 'genre') await setActiveGenre(ctx.projectId, id)
    else await setActiveFocusText(ctx.projectId, id)

    reload()
    onSwitched?.()
    restoreAnchor(anchor)

    setFlashed(kind)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashed(null), FLASH_MS)
  }

  if (!labels || !ctx) return null

  const rows =
    menu === 'genre'
      ? (genres ?? []).map((g) => ({ id: g.id, label: g.name, done: false }))
      : (passages ?? []).map((p) => ({
          id: p.id,
          label: p.reference,
          // Absent on rows written before v5, and the migration treats absent as
          // active, so this must too.
          done: p.status === 'completed',
        }))
  const activeId = menu === 'genre' ? ctx.genreId : ctx.focusTextId
  const ordered = [...rows].sort((a, b) => Number(a.done) - Number(b.done))

  return (
    // data-context-bar marks the whole switcher. Layout mounts this component
    // twice — a desktop one hidden below sm, and a mobile strip hidden above it
    // — so a check script must scope to the instance that is actually visible
    // rather than to whichever comes first in the DOM.
    <div
      ref={wrapRef}
      data-context-bar
      className={`relative flex min-w-0 items-center ${className}`}
    >
      <div className="flex min-w-0 items-center gap-1 truncate text-xs text-gray-500">
        <Trigger
          kind="passage"
          onClick={() => setMenu((m) => (m === 'passage' ? null : 'passage'))}
          open={menu === 'passage'}
          label={t('context.switchPassage')}
          tone="text-sky-700"
          flash={flashed === 'passage' ? 'bg-sky-100' : ''}
          text={labels.focusText}
        />
        <span className="text-gray-300">×</span>
        <Trigger
          kind="genre"
          onClick={() => setMenu((m) => (m === 'genre' ? null : 'genre'))}
          open={menu === 'genre'}
          label={t('context.switchGenre')}
          tone="text-emerald-700"
          flash={flashed === 'genre' ? 'bg-emerald-100' : ''}
          text={labels.genre}
        />
      </div>

      {menu && (
        // right-0, matching AccountMenu. This bar sits in the right-hand cluster
        // on a laptop and at the right end of the phone strip, so anchoring left
        // pushed a 256px panel off the screen: left 170 + 256 = 426 on a 390px
        // phone, which check-genre-switch.mjs caught and a desk-width look would
        // not have. The max-width is the backstop if the bar ever moves left.
        <div
          role="listbox"
          data-context-panel={menu}
          aria-label={menu === 'genre' ? t('context.switchGenre') : t('context.switchPassage')}
          className="absolute right-0 top-full z-30 mt-1 max-h-[60vh] w-64 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {sharedNote && <p className="px-3 py-1.5 text-xs text-gray-500">{sharedNote}</p>}
          {ordered.map((row, i) => {
            // `ordered` is a re-sort of `rows`, so the count that belongs to this
            // row is the one at its ORIGINAL index, not at i.
            const count = counts?.[rows.findIndex((r) => r.id === row.id)]
            const active = row.id === activeId
            const prevDone = i > 0 && ordered[i - 1].done
            return (
              <div key={row.id}>
                {row.done && !prevDone && (
                  <div className="mt-1 border-t border-gray-100 px-3 pb-1 pt-2 text-xs text-gray-400">
                    {t('context.completed')}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  data-context-row={row.id}
                  aria-selected={active}
                  onClick={() => void switchTo(menu, row.id)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-gray-100 ${
                    active ? 'font-medium text-gray-900' : 'text-gray-700'
                  } ${row.done ? 'opacity-60' : ''}`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {active ? '✓ ' : ''}
                    {row.label}
                  </span>
                  {count && count.total > 0 && (
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">
                      {count.done}/{count.total}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
          <Link
            to="/genres"
            onClick={close}
            className="mt-1 block border-t border-gray-100 px-3 pb-1 pt-2 text-xs text-gray-500 hover:text-gray-800"
          >
            {menu === 'genre' ? t('context.manageGenres') : t('context.managePassages')}
          </Link>
        </div>
      )}
    </div>
  )
}

function Trigger({
  kind,
  onClick,
  open,
  label,
  tone,
  flash,
  text,
}: {
  kind: 'genre' | 'passage'
  onClick: () => void
  open: boolean
  label: string
  tone: string
  flash: string
  text: string
}) {
  return (
    <button
      type="button"
      // A stable hook for scripts/check-genre-switch.mjs. The checks run against
      // a minified production bundle, where a Tailwind class list is not a
      // selector anyone should be matching on.
      data-context-switch={kind}
      onClick={onClick}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={label}
      className={`min-w-0 truncate rounded px-1 transition-colors hover:bg-gray-100 ${tone} ${flash}`}
    >
      <span className="truncate">{text}</span>
      <span className="ml-0.5 text-gray-300">▾</span>
    </button>
  )
}

/**
 * Does this menu's axis change the answers on this step?
 *
 * Answers live in one of three containers: genre-layer keyed by genre_id,
 * focusText-layer by focus_text_id, synthesis by worksheet_id (the pair). So a
 * genre-layer step gives every passage the same answer, and printing that number
 * once per passage would invent three pieces of work that do not exist.
 * Undefined when there is no step to reason about.
 */
function varies(layers: Layer[], menu: Menu): boolean | undefined {
  if (!menu || layers.length === 0) return undefined
  const axis: Layer = menu === 'genre' ? 'genre' : 'focusText'
  // Synthesis is the pair, so it varies along both axes.
  return layers.some((l) => l === 'synthesis' || l === axis)
}

/** A candidate context: this pair, with the worksheet it actually has (if any). */
function candidate(
  ctx: ActiveContext,
  focusTextId: string,
  genreId: string,
  worksheetFor: (f: string, g: string) => string,
): ActiveContext {
  return {
    projectId: ctx.projectId,
    focusTextId,
    genreId,
    worksheetId: worksheetFor(focusTextId, genreId),
  }
}
