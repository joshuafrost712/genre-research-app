import { useState } from 'react'
import { NavLink, useLocation, useParams } from 'react-router-dom'
import {
  findNode,
  stageRoute,
  workspaces,
  type JourneyStage,
  type StageGroup,
} from '../lib/content/loader'
import { visibleAtDepth, type DepthMode, type GuideNode } from '../schema/types'
import { useDepthMode } from './DepthModeContext'
import { useProgress } from './useProgress'
import { resolveGenreTokens, useNameTokens } from './GenreNameProvider'
import { isSupabaseConfigured } from '../lib/supabase/client'
import { LanguageSwitcher } from './LanguageSwitcher'
import { usePresence } from './PresenceProvider'
import { useLocale } from '../lib/i18n/LocaleContext'
import type { UiKey } from '../lib/i18n/strings'

const DEPTH_KEYS: Record<DepthMode, UiKey> = {
  quick: 'depth.quick',
  standard: 'depth.standard',
  comprehensive: 'depth.comprehensive',
}

/**
 * Persistent navigation menu, organized by the two WORKSPACES of the process:
 * Workspace 1 (Find & Describe Local Genres) and Workspace 2 (Create /
 * Translate). Three taps to anything: open the menu (mobile), expand a stage,
 * tap a page. Subsections hidden by the current depth mode are not shown, which
 * is the anti-overwhelm mechanism at the navigation level.
 */
// Labels are keys, not text: the menu is the most-read surface in the app, so
// leaving it English would make a translated worksheet feel like a veneer.
//
// Home stays outside the fold below as the escape hatch; everything else lives
// in a "Shortcuts" disclosure that starts COLLAPSED. Interview feedback
// (2026-08-25): during a session people hop between questionnaire pages
// constantly and touch these links rarely, so the page tree gets the vertical
// space by default. Team keeps first place INSIDE the fold — the Psalms-workshop
// lesson (teams could not find the link when it sat below nine others) is about
// ordering, and the fold header keeps the whole block one tap away.
const HOME_LINK: { to: string; key: UiKey; end?: boolean } = { to: '/', key: 'nav.home', end: true }
const QUICK_LINKS: { to: string; key: UiKey; end?: boolean }[] = [
  ...(isSupabaseConfigured() ? [{ to: '/teams', key: 'nav.team' as UiKey }] : []),
  { to: '/wizard', key: 'nav.wizard' },
  { to: '/capture', key: 'nav.capture' },
  { to: '/routing', key: 'nav.routing' },
  { to: '/review', key: 'nav.review' },
  { to: '/genres', key: 'nav.genres' },
  { to: '/follow-up', key: 'nav.followUp' },
  { to: '/export', key: 'nav.export' },
  { to: '/help', key: 'nav.help' },
]

// Device preference, not project data — same treatment as DepthModeContext.
// Read synchronously in the initializer so there is no flicker on first paint;
// both NavShell mounts (aside + drawer) re-read on mount, which is consistent
// enough for a toggle this coarse.
const QUICK_LINKS_COLLAPSED_KEY = 'navQuickLinksCollapsed'

const WORKSPACE_ACCENT: Record<string, string> = {
  w1: 'text-emerald-700',
  w2: 'text-sky-700',
}

/**
 * "somebody else is working here", on one tab.
 *
 * `nodeIds` is a list because a group row stands for its children: the dot on
 * "Style" has to account for a teammate two levels down inside it, or collapsing a
 * group would hide the only sign that anyone is in there.
 *
 * Names go in the `title`, never inline. This menu is the app's most-read surface
 * and it lives in a 288px column, so a name here would push the page label out of
 * a tab someone is trying to read. Renders null when nobody is there, which is
 * every tab most of the time.
 */
function PresenceDots({ nodeIds }: { nodeIds: string[] }) {
  const { peopleOn, nameOf } = usePresence()
  const { t } = useLocale()
  const people = peopleOn(nodeIds)
  if (people.length === 0) return null

  const names = people.map((p) => nameOf(p.userId)).join(', ')
  return (
    <span
      data-presence="dot"
      title={t('presence.who', { names })}
      className="ml-2 flex shrink-0 items-center gap-1 text-[10px] text-emerald-700"
    >
      <span aria-hidden className="inline-block size-1.5 rounded-full bg-emerald-500" />
      {people.length > 1 && <span>{people.length}</span>}
    </span>
  )
}

export function NavShell({ onNavigate }: { onNavigate?: () => void }) {
  const { mode, setMode } = useDepthMode()
  const progress = useProgress()
  const tokens = useNameTokens()
  const { t } = useLocale()
  const [linksCollapsed, setLinksCollapsed] = useState(
    () => localStorage.getItem(QUICK_LINKS_COLLAPSED_KEY) !== '0',
  )
  const toggleLinks = () => {
    const next = !linksCollapsed
    localStorage.setItem(QUICK_LINKS_COLLAPSED_KEY, next ? '1' : '0')
    setLinksCollapsed(next)
  }

  const pct =
    progress && progress.overall.total > 0
      ? Math.round((progress.overall.done / progress.overall.total) * 100)
      : 0

  return (
    <nav className="flex h-full flex-col gap-4 p-4 text-sm short:gap-2 short:p-2">
      {/* Also here, not just in the header: on a phone the nav lives in a drawer,
          and someone who opened the menu to move around should be able to change
          language in the same place rather than closing it again. */}
      <div className="shrink-0">
        <div className="mb-1 text-xs font-semibold text-gray-500">{t('lang.label')}</div>
        <LanguageSwitcher variant="block" />
      </div>

      <div className="shrink-0">
        <div className="flex items-stretch gap-1">
          <NavLink
            to={HOME_LINK.to}
            end={HOME_LINK.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `block flex-1 truncate rounded px-2 py-1.5 short:py-1 ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            {t(HOME_LINK.key)}
          </NavLink>
          <button
            type="button"
            onClick={toggleLinks}
            aria-expanded={!linksCollapsed}
            className="flex shrink-0 items-center gap-1 rounded px-2 text-xs text-gray-500 hover:bg-gray-100"
          >
            {t('nav.quickLinks')} <span className="text-gray-400">{linksCollapsed ? '+' : '−'}</span>
          </button>
        </div>
        {!linksCollapsed && (
          <ul className="mt-0.5 grid grid-cols-1 gap-0.5 short:grid-cols-2 short:gap-x-2">
            {QUICK_LINKS.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={l.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `block truncate rounded px-2 py-1.5 short:py-1 ${
                      isActive ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  {t(l.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      {progress && progress.overall.total > 0 && (
        <div className="shrink-0">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>
              {t('nav.progress')} ({t(DEPTH_KEYS[mode])})
            </span>
            <span>
              {progress.overall.done}/{progress.overall.total} · {pct}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="shrink-0">
        <div className="mb-1 font-semibold text-gray-700">{t('nav.depth')}</div>
        <div className="flex gap-1" role="group" aria-label={t('nav.depth')}>
          {(['quick', 'standard'] as DepthMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                mode === m
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t(DEPTH_KEYS[m])}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
        {workspaces().map((ws, i) => (
          <div key={ws.id}>
            <div className="px-1 pb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {t('nav.workspace', { n: i + 1 })}
              </div>
              <div
                className={`text-sm font-semibold ${WORKSPACE_ACCENT[ws.id]}`}
                data-dfb-node={ws.titleNodeId}
                data-dfb-field="label"
              >
                {resolveGenreTokens(ws.title, tokens)}
              </div>
            </div>
            <ul className="flex flex-col gap-1">
              {ws.stages.map((stage) => (
                <StageNav key={stage.id} stage={stage} mode={mode} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}

/**
 * One journey stage in the menu: a direct link when it is a single page, or a
 * collapsible group of its pages when it holds several (1a–1c, 1d, 1e).
 */
function StageNav({
  stage,
  mode,
  onNavigate,
}: {
  stage: JourneyStage
  mode: DepthMode
  onNavigate?: () => void
}) {
  const { nodeId } = useParams()
  const progress = useProgress()
  const genre = useNameTokens()
  // Expanded by default (2026-08-25): every questionnaire page should be one
  // direct tap during an interview, not hidden behind a stage toggle. Manual
  // collapse still works, and the active route still forces its stage open.
  const [collapsed, setCollapsed] = useState(false)

  // A multi-group stage (describe: 1b/1c/1d/1e) renders as a nested tree with a
  // landing link, its 1d/1e groups nesting their sub-pages one level deeper.
  if (stage.groups && stage.groups.length > 0) {
    return <NestedStageNav stage={stage} mode={mode} onNavigate={onNavigate} />
  }

  const subs = stage.subIds
    .map((id) => findNode(id)?.node)
    .filter((n): n is GuideNode => !!n)
    .filter((n) => visibleAtDepth(n, mode))

  if (subs.length === 0 && !stage.route) return null

  // Single page (or a dedicated app page): one direct link.
  if (subs.length <= 1) {
    const to = stageRoute(stage)
    const count = subs[0] ? progress?.bySubsection[subs[0].id] : undefined
    return (
      <li>
        <NavLink
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-between rounded px-2 py-1.5 lg:py-1 ${
              isActive || (subs[0] && nodeId === subs[0].id)
                ? 'bg-gray-800 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`
          }
        >
          <span className="truncate" data-dfb-node={stage.titleNodeId} data-dfb-field="label">
            {resolveGenreTokens(stage.title, genre)}
          </span>
          {/* Grouped so the progress count keeps the right edge it has always had.
              Three children under justify-between would space them evenly and
              move the count into the middle of the row. */}
          <span className="ml-2 flex shrink-0 items-center">
            {count && count.total > 0 && (
              <span className="text-[10px] text-gray-400">
                {count.done}/{count.total}
              </span>
            )}
            {subs[0] && <PresenceDots nodeIds={[subs[0].id]} />}
          </span>
        </NavLink>
      </li>
    )
  }

  const containsActive = subs.some((s) => s.id === nodeId)

  return (
    <li>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-medium text-gray-700 hover:bg-gray-100 lg:py-1"
        aria-expanded={!collapsed && !containsActive ? false : undefined}
      >
        <span className="truncate" data-dfb-node={stage.titleNodeId} data-dfb-field="label">
          {resolveGenreTokens(stage.title, genre)}
        </span>
        {/* The stage row aggregates its pages, so a collapsed stage still shows
            that somebody is working inside it. */}
        <span className="ml-2 flex shrink-0 items-center">
          <PresenceDots nodeIds={subs.map((s) => s.id)} />
          <span className="ml-1 text-gray-400">{collapsed && !containsActive ? '+' : '−'}</span>
        </span>
      </button>
      {(!collapsed || containsActive) && (
        <ul className="mt-0.5 flex flex-col gap-0.5 pl-3">
          {subs.map((sub) => {
            const count = progress?.bySubsection[sub.id]
            return (
              <li key={sub.id}>
                <NavLink
                  to={`/worksheet/${sub.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded px-2 py-1.5 lg:py-1 ${
                      isActive || nodeId === sub.id
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  <span className="truncate">{resolveGenreTokens(sub.label, genre)}</span>
                  <span className="ml-2 flex shrink-0 items-center">
                    {count && count.total > 0 && (
                      <span className="text-[10px] text-gray-400">
                        {count.done}/{count.total}
                      </span>
                    )}
                    <PresenceDots nodeIds={[sub.id]} />
                  </span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

/**
 * The describe stage's two-level menu: a collapsible whose label opens the
 * landing page, holding leaf pages (1b, 1c) and further-nested groups (1d, 1e)
 * whose sub-pages indent one more level. Mirrors feedback #5's request that the
 * side menu reflect the process structure at a glance.
 */
function NestedStageNav({
  stage,
  mode,
  onNavigate,
}: {
  stage: JourneyStage
  mode: DepthMode
  onNavigate?: () => void
}) {
  const { nodeId } = useParams()
  const { pathname } = useLocation()
  const genre = useNameTokens()
  const landing = stage.route ?? stageRoute(stage)
  const active = pathname.startsWith('/describe') || (!!nodeId && stage.subIds.includes(nodeId))
  const [collapsed, setCollapsed] = useState(false) // expanded by default, see StageNav
  const open = !collapsed || active

  return (
    <li>
      <div className="flex items-stretch">
        <NavLink
          to={landing}
          onClick={onNavigate}
          end
          className={({ isActive }) =>
            `flex flex-1 items-center justify-between truncate rounded px-2 py-1.5 font-medium lg:py-1 ${
              isActive ? 'bg-gray-800 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`
          }
        >
          <span className="truncate" data-dfb-node={stage.titleNodeId} data-dfb-field="label">
            {resolveGenreTokens(stage.title, genre)}
          </span>
          {/* Every page in the stage, including the ones nested two levels down
              inside 1d/1e, so collapsing this row never hides the room. */}
          <PresenceDots nodeIds={stage.subIds} />
        </NavLink>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
          className="ml-1 rounded px-2 text-gray-400 hover:bg-gray-100"
        >
          {open ? '−' : '+'}
        </button>
      </div>
      {open && (
        <ul className="mt-0.5 flex flex-col gap-0.5 pl-3">
          {stage.groups!.map((group) => (
            <GroupNav key={group.nodeId} group={group} mode={mode} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** One entry inside the describe menu: a leaf page link, or a nested sub-group. */
function GroupNav({
  group,
  mode,
  onNavigate,
}: {
  group: StageGroup
  mode: DepthMode
  onNavigate?: () => void
}) {
  const { nodeId } = useParams()
  const { pathname } = useLocation()
  const genre = useNameTokens()
  // Declared before any early return so hook order stays stable (rules-of-hooks);
  // only the nested-group branch below actually uses it.
  const [collapsed, setCollapsed] = useState(false) // expanded by default, see StageNav
  const node = findNode(group.nodeId)?.node
  if (!node) return null

  // A leaf page (1b, 1c): a single link.
  if (!group.childIds || group.childIds.length === 0) {
    return (
      <li>
        <NavLink
          to={group.route}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-between rounded px-2 py-1.5 lg:py-1 ${
              isActive || nodeId === group.nodeId
                ? 'bg-gray-800 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          {/* Was a `block truncate` link. Now a flex row with the truncation moved
              onto the label span, so the dot cannot be clipped along with the text. */}
          <span className="truncate">{resolveGenreTokens(node.label, genre)}</span>
          <PresenceDots nodeIds={[group.nodeId]} />
        </NavLink>
      </li>
    )
  }

  // A nested group (1d, 1e): landing link + collapsible sub-pages.
  const children = group.childIds
    .map((id) => findNode(id)?.node)
    .filter((n): n is GuideNode => !!n)
    .filter((n) => visibleAtDepth(n, mode))
  const containsActive = pathname === group.route || (nodeId ? group.childIds.includes(nodeId) : false)
  const open = !collapsed || containsActive

  return (
    <li>
      <div className="flex items-stretch">
        <NavLink
          to={group.route}
          onClick={onNavigate}
          end
          className={({ isActive }) =>
            `flex flex-1 items-center justify-between truncate rounded px-2 py-1.5 lg:py-1 ${
              isActive ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`
          }
        >
          <span className="truncate">{resolveGenreTokens(node.label, genre)}</span>
          {/* The group's own landing page plus its sub-pages. */}
          <PresenceDots nodeIds={[group.nodeId, ...(group.childIds ?? [])]} />
        </NavLink>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={open ? 'Collapse' : 'Expand'}
          className="ml-1 rounded px-2 text-gray-400 hover:bg-gray-100"
        >
          {open ? '−' : '+'}
        </button>
      </div>
      {open && (
        <ul className="mt-0.5 flex flex-col gap-0.5 pl-3">
          {children.map((sub) => (
            <li key={sub.id}>
              <NavLink
                to={`/worksheet/${sub.id}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded px-2 py-1.5 lg:py-1 ${
                    isActive || nodeId === sub.id
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`
                }
              >
                <span className="truncate">{resolveGenreTokens(sub.label, genre)}</span>
                <PresenceDots nodeIds={[sub.id]} />
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
