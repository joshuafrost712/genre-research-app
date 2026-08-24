import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getLastNode } from '../lib/storage/appState'
import { db } from '../lib/storage/db'
import {
  findNode,
  journeyOrder,
  splitStageTitle,
  stageRoute,
  workspaces,
  type JourneyStage,
  type Workspace,
} from '../lib/content/loader'
import { useActiveContext } from '../components/ActiveContextProvider'
import { resolveGenreTokens, useNameTokens } from '../components/GenreNameProvider'
import { useProgress } from '../components/useProgress'
import { TeamCard } from '../components/team/TeamCard'
import { ScopeBackfillCard } from '../components/onboarding/ScopeBackfillCard'
import type { ProgressReport } from '../lib/progress'

/**
 * Home: the workflow chart itself. The two workspaces of the process are drawn
 * as stages a user can tap — Workspace 1 (Find & Describe Local Genres, the
 * standalone ethnography) flowing into Workspace 2 (Create / Translate, which
 * consumes it for one passage). The same chart prints as a one-pager from
 * /chart. The menu still lets anyone jump anywhere; this page is the overview.
 */
export function Dashboard() {
  const { ctx } = useActiveContext()
  const progress = useProgress()

  const labels = useLiveQuery(async () => {
    if (!ctx) return null
    const [focusText, genre] = await Promise.all([
      db.focusTexts.get(ctx.focusTextId),
      db.genres.get(ctx.genreId),
    ])
    return {
      passage: focusText?.reference ?? '',
      genre: genre?.name ?? '',
    }
  }, [ctx?.focusTextId, ctx?.genreId])
  const lastNodeId = useLiveQuery(
    async () => (ctx ? ((await getLastNode(ctx.projectId)) ?? null) : null),
    [ctx?.projectId],
  )

  if (!ctx || labels === undefined) {
    return <p className="text-gray-500">Loading…</p>
  }

  const [w1, w2] = workspaces()
  const resumeId = lastNodeId ?? journeyOrder()[0]
  const resumeRef = resumeId ? findNode(resumeId) : undefined

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Local Genres Research</h1>
        <p className="mt-1 text-sm text-gray-500">
          Two workspaces: first learn your people's genres, then create with them. Tap any step.
        </p>
      </div>

      {/* Above "working on", because which team owns the work is the outer
          question: the passage and genre only mean something once you know whose
          set of them you are looking at. */}
      <TeamCard />

      <ScopeBackfillCard />

      <WorkingOn passage={labels?.passage} genre={labels?.genre} />

      {resumeRef && lastNodeId && (
        <Link
          to={`/worksheet/${resumeRef.node.id}`}
          className="rounded-xl bg-gray-800 px-5 py-3 text-center text-white hover:bg-gray-700"
        >
          <div className="text-base font-semibold">Continue</div>
          <div className="mt-0.5 truncate text-sm text-gray-200">{resumeRef.node.label}</div>
        </Link>
      )}

      <WorkspacePanel ws={w1} number={1} accent="emerald" progress={progress} />

      <div className="flex items-center gap-3 px-2 text-xs text-gray-400">
        <span className="text-lg leading-none">↓</span>
        <span>Your genre descriptions feed every passage you take into Workspace 2.</span>
      </div>

      <WorkspacePanel ws={w2} number={2} accent="sky" progress={progress} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
        <Link to="/chart" className="text-sky-700 hover:underline">
          Print this workflow chart
        </Link>
        <Link to="/capture" className="text-sky-700 hover:underline">
          Quick note
        </Link>
        <Link to="/wizard" className="text-sky-700 hover:underline">
          Go one question at a time
        </Link>
        <Link to="/export" className="text-sky-700 hover:underline">
          Export
        </Link>
      </div>

      <p className="text-xs text-gray-400">
        You can open any step in any order from the menu. Standard view shows every
        question; switch to Quick in the menu for a shorter version.
      </p>
    </div>
  )
}

const ACCENTS = {
  emerald: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/50',
    title: 'text-emerald-800',
    chip: 'bg-emerald-100 text-emerald-800',
  },
  sky: {
    border: 'border-sky-200',
    bg: 'bg-sky-50/50',
    title: 'text-sky-800',
    chip: 'bg-sky-100 text-sky-800',
  },
} as const

function WorkspacePanel({
  ws,
  number,
  accent,
  progress,
}: {
  ws: Workspace
  number: number
  accent: keyof typeof ACCENTS
  progress: ProgressReport | null
}) {
  const a = ACCENTS[accent]
  const tokens = useNameTokens()
  // The current stage: the first with work remaining (stages without countable
  // work, like the summary table, are skipped by the counter).
  const currentId =
    ws.stages.find((s) => {
      const c = stageCount(s, progress)
      return c.total === 0 || c.done < c.total
    })?.id ?? ws.stages[ws.stages.length - 1]?.id

  return (
    <section className={`rounded-2xl border ${a.border} ${a.bg} p-4`}>
      <div className="mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Workspace {number}
        </div>
        <h2
          className={`text-lg font-semibold ${a.title}`}
          data-dfb-node={ws.titleNodeId}
          data-dfb-field="label"
        >
          {resolveGenreTokens(ws.title, tokens)}
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">{ws.blurb}</p>
      </div>
      <ol className="flex flex-col gap-2">
        {ws.stages.map((stage) => (
          <StageRow
            key={stage.id}
            stage={stage}
            chipClass={a.chip}
            progress={progress}
            isCurrent={stage.id === currentId}
          />
        ))}
      </ol>
    </section>
  )
}

function StageRow({
  stage,
  chipClass,
  progress,
  isCurrent,
}: {
  stage: JourneyStage
  chipClass: string
  progress: ProgressReport | null
  isCurrent: boolean
}) {
  const { done, total } = stageCount(stage, progress)
  const tokens = useNameTokens()
  const complete = total > 0 && done >= total
  const [letters, title] = splitStageTitle(resolveGenreTokens(stage.title, tokens))
  return (
    <li>
      <Link
        to={stageRoute(stage)}
        className={`flex items-center gap-3 rounded-xl border bg-white px-3 py-2.5 hover:bg-gray-50 ${
          isCurrent ? 'border-gray-800 ring-1 ring-gray-800' : 'border-gray-200'
        }`}
      >
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${chipClass}`}
        >
          {letters}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className="truncate text-sm font-medium text-gray-800"
              data-dfb-node={stage.titleNodeId}
              data-dfb-field="label"
            >
              {title}
            </span>
            {complete && <span className="text-emerald-600">✓</span>}
            {isCurrent && !complete && (
              <span className="shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-white">
                You are here
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">{stage.blurb}</span>
        </span>
        {total > 0 && (
          <span className="shrink-0 text-xs text-gray-400">
            {done}/{total}
          </span>
        )}
      </Link>
    </li>
  )
}

/** Sums a stage's subsection progress. */
function stageCount(stage: JourneyStage, progress: ProgressReport | null) {
  let done = 0
  let total = 0
  for (const subId of stage.subIds) {
    const c = progress?.bySubsection[subId]
    if (c) {
      done += c.done
      total += c.total
    }
  }
  return { done, total }
}

function WorkingOn({ passage, genre }: { passage?: string; genre?: string }) {
  const hasPassage = passage && !passage.startsWith('Untitled')
  const hasGenre = genre && !genre.startsWith('Untitled')
  return (
    <Link
      to="/genres"
      className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50"
      title="Change the passage or genre"
    >
      <div className="min-w-0">
        <div className="text-xs text-gray-500">You are working on</div>
        <div className="truncate text-sm">
          <span className="font-medium text-sky-700">{hasPassage ? passage : 'No passage named yet'}</span>
          <span className="mx-1.5 text-gray-300">×</span>
          <span className="font-medium text-emerald-700">{hasGenre ? genre : 'No genre named yet'}</span>
        </div>
      </div>
      <span className="shrink-0 text-xs text-gray-400">Change ▾</span>
    </Link>
  )
}
