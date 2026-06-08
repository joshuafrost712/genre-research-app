import { useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { navTree } from '../lib/content/loader'
import { visibleAtDepth, type DepthMode } from '../schema/types'
import { useDepthMode } from './DepthModeContext'

const DEPTH_LABELS: Record<DepthMode, string> = {
  quick: 'Quick',
  standard: 'Standard',
  comprehensive: 'Comprehensive',
}

const LAYER_BADGE: Record<string, string> = {
  genre: 'bg-emerald-100 text-emerald-800',
  focusText: 'bg-sky-100 text-sky-800',
  synthesis: 'bg-amber-100 text-amber-800',
}

/**
 * Persistent navigation menu. Three taps to anything: open the menu (mobile),
 * expand a section, tap a subsection. Sections start expanded so on a wide screen
 * every subsection is one tap. Subsections hidden by the current depth mode are
 * not shown, which is the anti-overwhelm mechanism at the navigation level.
 */
export function NavShell({ onNavigate }: { onNavigate?: () => void }) {
  const { mode, setMode } = useDepthMode()
  const { nodeId } = useParams()
  const tree = navTree()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggle = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  return (
    <nav className="flex h-full flex-col gap-4 p-4 text-sm">
      <div>
        <div className="mb-1 font-semibold text-gray-700">Depth</div>
        <div className="flex gap-1" role="group" aria-label="Depth mode">
          {(['quick', 'standard', 'comprehensive'] as DepthMode[]).map((m) => (
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

      <ul className="flex flex-col gap-3 overflow-y-auto">
        {tree.map(({ section, subsections }) => {
          const visibleSubs = subsections.filter((s) => visibleAtDepth(s, mode))
          if (visibleSubs.length === 0) return null
          const isCollapsed = collapsed[section.id]
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => toggle(section.id)}
                className="flex w-full items-center justify-between rounded px-1 py-1 text-left font-semibold text-gray-800 hover:bg-gray-100"
                aria-expanded={!isCollapsed}
              >
                <span>{section.label}</span>
                <span className="text-gray-400">{isCollapsed ? '+' : '−'}</span>
              </button>
              {!isCollapsed && (
                <ul className="mt-1 flex flex-col gap-0.5 pl-2">
                  {visibleSubs.map((sub) => (
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
                        <span>{sub.label}</span>
                        {sub.layer && (
                          <span
                            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              LAYER_BADGE[sub.layer] ?? 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {sub.layer}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
