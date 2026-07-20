import { useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { findNode, stageRoute, workspaces, type JourneyStage } from '../lib/content/loader'
import { visibleAtDepth, type DepthMode, type GuideNode } from '../schema/types'
import { useDepthMode } from './DepthModeContext'
import { useProgress } from './useProgress'
import { resolveGenreTokens, useGenreName } from './GenreNameProvider'
import { isGoogleConfigured } from '../lib/google/auth'

const DEPTH_LABELS: Record<DepthMode, string> = {
  quick: 'Quick',
  standard: 'Standard',
  comprehensive: 'Comprehensive',
}

/**
 * Persistent navigation menu, organized by the two WORKSPACES of the process:
 * Workspace 1 (Find & Describe Local Genres) and Workspace 2 (Create /
 * Translate). Three taps to anything: open the menu (mobile), expand a stage,
 * tap a page. Subsections hidden by the current depth mode are not shown, which
 * is the anti-overwhelm mechanism at the navigation level.
 */
const QUICK_LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Home', end: true },
  { to: '/wizard', label: 'Step-by-step guide' },
  { to: '/capture', label: 'Quick note' },
  { to: '/routing', label: 'Sort notes with AI' },
  { to: '/review', label: 'Review AI suggestions' },
  { to: '/genres', label: 'Passages & Genres' },
  { to: '/priorities', label: 'Your priorities' },
  { to: '/follow-up', label: 'Follow up' },
  { to: '/export', label: 'Export' },
  { to: '/help', label: 'Help' },
  // Teams (cloud sharing) only appears when Google sign-in is configured.
  ...(isGoogleConfigured() ? [{ to: '/teams', label: 'Teams' }] : []),
]

const WORKSPACE_ACCENT: Record<string, string> = {
  w1: 'text-emerald-700',
  w2: 'text-sky-700',
}

export function NavShell({ onNavigate }: { onNavigate?: () => void }) {
  const { mode, setMode } = useDepthMode()
  const progress = useProgress()

  const pct =
    progress && progress.overall.total > 0
      ? Math.round((progress.overall.done / progress.overall.total) * 100)
      : 0

  return (
    <nav className="flex h-full flex-col gap-4 p-4 text-sm short:gap-2 short:p-2">
      <ul className="grid grid-cols-1 gap-0.5 shrink-0 short:grid-cols-2 short:gap-x-2">
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
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>

      {progress && progress.overall.total > 0 && (
        <div className="shrink-0">
          <div className="mb-1 flex justify-between text-xs text-gray-500">
            <span>Progress ({mode})</span>
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
        <div className="mb-1 font-semibold text-gray-700">Depth</div>
        <div className="flex gap-1" role="group" aria-label="Depth mode">
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
              {DEPTH_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
        {workspaces().map((ws, i) => (
          <div key={ws.id}>
            <div className="px-1 pb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Workspace {i + 1}
              </div>
              <div className={`text-sm font-semibold ${WORKSPACE_ACCENT[ws.id]}`}>{ws.title}</div>
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
  const genre = useGenreName()
  const [collapsed, setCollapsed] = useState(true)

  const subs = stage.subIds
    .map((id) => findNode(id)?.node)
    .filter((n): n is GuideNode => !!n)
    .filter((n) => visibleAtDepth(n, mode))

  if (subs.length === 0 && !stage.route) return null

  // Single page (or a dedicated app page): one direct link.
  if (subs.length <= 1) {
    const to = stage.route ?? `/worksheet/${subs[0].id}`
    const count = subs[0] ? progress?.bySubsection[subs[0].id] : undefined
    return (
      <li>
        <NavLink
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-between rounded px-2 py-1.5 ${
              isActive || (subs[0] && nodeId === subs[0].id)
                ? 'bg-gray-800 text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`
          }
        >
          <span className="truncate">{stage.title}</span>
          {count && count.total > 0 && (
            <span className="ml-2 shrink-0 text-[10px] text-gray-400">
              {count.done}/{count.total}
            </span>
          )}
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
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left font-medium text-gray-700 hover:bg-gray-100"
        aria-expanded={!collapsed && !containsActive ? false : undefined}
      >
        <span className="truncate">{stage.title}</span>
        <span className="text-gray-400">{collapsed && !containsActive ? '+' : '−'}</span>
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
                    `flex items-center justify-between rounded px-2 py-1.5 ${
                      isActive || nodeId === sub.id
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`
                  }
                >
                  <span className="truncate">{resolveGenreTokens(sub.label, genre)}</span>
                  {count && count.total > 0 && (
                    <span className="ml-2 shrink-0 text-[10px] text-gray-400">
                      {count.done}/{count.total}
                    </span>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
