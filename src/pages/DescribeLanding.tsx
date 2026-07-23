import { Link } from 'react-router-dom'
import {
  findNode,
  journey,
  routeForSub,
  splitStageTitle,
  type StageGroup,
} from '../lib/content/loader'
import { resolveGenreTokens, useNameTokens } from '../components/GenreNameProvider'
import { useProgress } from '../components/useProgress'
import type { ProgressReport } from '../lib/progress'

/**
 * A landing page for the "1b–1e: Describe a Genre" group and for its 1d / 1e
 * sub-groups (feedback #5). It lays out the parts of the process at a glance so
 * the researcher can see the structure and choose which page to open, rather
 * than only ever meeting them one flat list at a time. Each card links to a
 * worksheet page, or (for 1d and 1e) to a deeper landing of its sub-pages.
 */
export function DescribeLanding({ groupId }: { groupId: 'top' | 's2' | 's3' }) {
  const tokens = useNameTokens()
  const progress = useProgress()
  const describe = journey().find((s) => s.id === 'describe')

  if (groupId === 'top') {
    const groups = describe?.groups ?? []
    return (
      <div className="flex flex-col gap-5">
        <Header
          title="1b–1e: Describe a Genre"
          blurb="Study one genre across four areas: its purpose, its social features, its big picture, and its style details. Open them in order, or jump to the part you want."
        />
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <GroupCard key={g.nodeId} group={g} tokens={tokens} progress={progress} />
          ))}
        </ul>
      </div>
    )
  }

  // A 1d / 1e sub-landing: cards for the container node's sub-pages.
  const container = findNode(groupId)?.node
  const children = container?.children ?? []
  return (
    <div className="flex flex-col gap-5">
      <Link to="/describe" className="text-sm text-sky-700 hover:underline">
        ← Back to Describe a Genre
      </Link>
      <Header
        title={resolveGenreTokens(container?.label ?? '', tokens)}
        blurb={resolveGenreTokens(container?.guidance ?? '', tokens)}
      />
      <ul className="flex flex-col gap-2">
        {children.map((child) => (
          <PageCard
            key={child.id}
            title={resolveGenreTokens(child.label, tokens)}
            to={routeForSub(child.id)}
            count={progress?.bySubsection[child.id]}
          />
        ))}
      </ul>
    </div>
  )
}

function Header({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {blurb && <p className="mt-1 text-sm text-gray-500">{blurb}</p>}
    </div>
  )
}

/** A card for a describe entry: a single page (1b, 1c) or a 1d/1e sub-group. */
function GroupCard({
  group,
  tokens,
  progress,
}: {
  group: StageGroup
  tokens: ReturnType<typeof useNameTokens>
  progress: ProgressReport | null
}) {
  const node = findNode(group.nodeId)?.node
  const label = resolveGenreTokens(node?.label ?? '', tokens)
  const [letters, title] = splitStageTitle(label)
  const blurb = resolveGenreTokens(node?.guidance ?? '', tokens)
  // Progress: a leaf page counts itself; a group counts its sub-pages.
  const subIds = group.childIds ?? [group.nodeId]
  const { done, total } = subIds.reduce(
    (acc, id) => {
      const c = progress?.bySubsection[id]
      return c ? { done: acc.done + c.done, total: acc.total + c.total } : acc
    },
    { done: 0, total: 0 },
  )
  return (
    <li>
      <Link
        to={group.route}
        className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 hover:bg-gray-50"
      >
        <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
          {letters}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-800">{title}</span>
          {blurb && <span className="mt-0.5 block truncate text-xs text-gray-500">{blurb}</span>}
        </span>
        {group.childIds ? (
          <span className="shrink-0 text-xs text-gray-400">{group.childIds.length} pages ›</span>
        ) : (
          total > 0 && (
            <span className="shrink-0 text-xs text-gray-400">
              {done}/{total}
            </span>
          )
        )}
      </Link>
    </li>
  )
}

/** A card for a single worksheet page (a 1d.x / 1e.x sub-page). */
function PageCard({
  title,
  to,
  count,
}: {
  title: string
  to: string
  count?: { done: number; total: number }
}) {
  const [letters, rest] = splitStageTitle(title)
  return (
    <li>
      <Link
        to={to}
        className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 hover:bg-gray-50"
      >
        <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
          {letters}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{rest}</span>
        {count && count.total > 0 && (
          <span className="shrink-0 text-xs text-gray-400">
            {count.done}/{count.total}
          </span>
        )}
      </Link>
    </li>
  )
}
