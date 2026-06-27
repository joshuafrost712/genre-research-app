import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getLastNode } from '../lib/storage/appState'
import { db } from '../lib/storage/db'
import { findNode, journey, journeyOrder, type JourneyStage } from '../lib/content/loader'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useProgress } from '../components/useProgress'
import type { ProgressReport } from '../lib/progress'

/**
 * Home: a guided "journey" a translator can follow alone. It shows what you are
 * working on, one big Continue button, and the 5 steps in the order the work
 * actually happens (purpose -> find genres -> study -> put together). The section
 * menu is still there for jumping anywhere; this page is the recommended path.
 */
export function Dashboard() {
  const { ctx } = useActiveContext()
  const progress = useProgress()

  const project = useLiveQuery(
    async () => (ctx ? ((await db.projects.get(ctx.projectId)) ?? null) : null),
    [ctx?.projectId],
  )
  const labels = useLiveQuery(async () => {
    if (!ctx) return null
    const [focusText, genre] = await Promise.all([
      db.focusTexts.get(ctx.focusTextId),
      db.genres.get(ctx.genreId),
    ])
    return {
      psalm: focusText?.reference ?? '',
      genre: genre?.name ?? '',
    }
  }, [ctx?.focusTextId, ctx?.genreId])
  const lastNodeId = useLiveQuery(
    async () => (ctx ? ((await getLastNode(ctx.projectId)) ?? null) : null),
    [ctx?.projectId],
  )

  if (!ctx || project === undefined || labels === undefined) {
    return <p className="text-gray-500">Loading…</p>
  }

  const stages = journey()
  const needsSetup =
    !labels?.psalm || labels.psalm.startsWith('Untitled') ||
    !labels?.genre || labels.genre.startsWith('Untitled')

  const resumeId = lastNodeId ?? journeyOrder()[0]
  const resumeRef = resumeId ? findNode(resumeId) : undefined

  const pct =
    progress && progress.overall.total > 0
      ? Math.round((progress.overall.done / progress.overall.total) * 100)
      : 0

  // The current step = first stage not yet complete (else the last stage).
  const currentStageId =
    stages.find((s) => {
      const c = stageCount(s, progress)
      return c.total === 0 || c.done < c.total
    })?.id ?? stages[stages.length - 1]?.id

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Local Genres Research</h1>

      {needsSetup ? (
        <SetupCard psalm={labels?.psalm} genre={labels?.genre} />
      ) : (
        <WorkingOn psalm={labels.psalm} genre={labels.genre} />
      )}

      {progress && progress.overall.total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-sm text-gray-600">
            <span>Your progress</span>
            <span>{pct}% done</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {resumeRef && (
        <Link
          to={`/worksheet/${resumeRef.node.id}`}
          className="rounded-xl bg-gray-800 px-5 py-4 text-center text-white hover:bg-gray-700"
        >
          <div className="text-base font-semibold">{lastNodeId ? 'Continue' : 'Start'}</div>
          <div className="mt-0.5 text-sm text-gray-200">{resumeRef.node.label}</div>
        </Link>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">The steps</h2>
        {stages.map((stage) => (
          <StageCard
            key={stage.id}
            stage={stage}
            progress={progress}
            isCurrent={stage.id === currentStageId}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
        <Link to="/capture" className="text-sky-700 hover:underline">
          Quick note
        </Link>
        <Link to="/wizard" className="text-sky-700 hover:underline">
          Go through one question at a time
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

function SetupCard({ psalm, genre }: { psalm?: string; genre?: string }) {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <div className="font-semibold text-sky-900">Welcome — let's set up</div>
      <p className="mt-1 text-sm text-sky-900">
        First, give your psalm a name (for example, "Psalm 13") and name the genre
        you are studying. Then come back here and press Start.
      </p>
      <Link
        to="/genres"
        className="mt-3 inline-block rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
      >
        Name your psalm and genre →
      </Link>
      {(psalm || genre) && (
        <p className="mt-2 text-xs text-sky-800">
          Right now: {psalm || 'Untitled'} × {genre || 'Untitled'}
        </p>
      )}
    </div>
  )
}

function WorkingOn({ psalm, genre }: { psalm: string; genre: string }) {
  return (
    <Link
      to="/genres"
      className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50"
      title="Change the psalm or genre"
    >
      <div className="min-w-0">
        <div className="text-xs text-gray-500">You are working on</div>
        <div className="truncate text-sm">
          <span className="font-medium text-sky-700">{psalm}</span>
          <span className="mx-1.5 text-gray-300">×</span>
          <span className="font-medium text-emerald-700">{genre}</span>
        </div>
      </div>
      <span className="shrink-0 text-xs text-gray-400">Change ▾</span>
    </Link>
  )
}

function StageCard({
  stage,
  progress,
  isCurrent,
}: {
  stage: JourneyStage
  progress: ProgressReport | null
  isCurrent: boolean
}) {
  const { done, total } = stageCount(stage, progress)
  const complete = total > 0 && done >= total
  const firstSub = stage.subIds[0]
  return (
    <Link
      to={`/worksheet/${firstSub}`}
      className={`rounded-xl border bg-white p-4 hover:bg-gray-50 ${
        isCurrent ? 'border-gray-800 ring-1 ring-gray-800' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{stage.title}</span>
            {complete && <span className="text-emerald-600">✓</span>}
            {isCurrent && !complete && (
              <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-white">
                You are here
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-500">{stage.blurb}</p>
        </div>
        {total > 0 && (
          <span className="shrink-0 text-xs text-gray-400">
            {done}/{total}
          </span>
        )}
      </div>
    </Link>
  )
}
