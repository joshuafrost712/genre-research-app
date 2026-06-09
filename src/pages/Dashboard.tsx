import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getLastNode } from '../lib/storage/appState'
import { db } from '../lib/storage/db'
import { findNode, navOrder } from '../lib/content/loader'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useProgress } from '../components/useProgress'

/**
 * Home dashboard: shows the active project and progress, and the two entry points
 * into the worksheet (resume or wizard) plus quick links. Multi-file management
 * is handled on the Genres & focus texts screen.
 */
export function Dashboard() {
  const { ctx } = useActiveContext()
  const progress = useProgress()

  const project = useLiveQuery(
    async () => (ctx ? ((await db.projects.get(ctx.projectId)) ?? null) : null),
    [ctx?.projectId],
  )
  const lastNodeId = useLiveQuery(
    async () => (ctx ? ((await getLastNode(ctx.projectId)) ?? null) : null),
    [ctx?.projectId],
  )

  if (!ctx || project === undefined) {
    return <p className="text-gray-500">Loading…</p>
  }

  const firstNodeId = navOrder()[0]
  const resumeRef = lastNodeId ? findNode(lastNodeId) : undefined
  const pct =
    progress && progress.overall.total > 0
      ? Math.round((progress.overall.done / progress.overall.total) * 100)
      : 0

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{project?.name ?? 'Project'}</h1>
        <p className="mt-1 text-sm text-gray-500">Worksheet config {project?.config_version}</p>
      </div>

      {progress && progress.overall.total > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-sm text-gray-600">
            <span>Progress</span>
            <span>
              {progress.overall.done}/{progress.overall.total} · {pct}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {resumeRef && (
          <Link
            to={`/worksheet/${resumeRef.node.id}`}
            className="rounded-lg bg-gray-800 px-4 py-3 text-center font-medium text-white hover:bg-gray-700"
          >
            Resume: {resumeRef.node.label}
          </Link>
        )}
        <Link
          to="/wizard"
          className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
        >
          Guided wizard
        </Link>
        {firstNodeId && (
          <Link
            to={`/worksheet/${firstNodeId}`}
            className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
          >
            {resumeRef ? 'Start from the beginning' : 'Start the worksheet'}
          </Link>
        )}
        <Link
          to="/capture"
          className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-50"
        >
          Capture a note
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <div className="mb-1 font-semibold text-gray-700">New here?</div>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            Open{' '}
            <Link to="/genres" className="text-sky-700 underline">
              Genres &amp; focus texts
            </Link>{' '}
            and name the focus text (e.g. “Psalm 13”) and the genre you're studying.
          </li>
          <li>
            Work the worksheet (menu, or the{' '}
            <Link to="/wizard" className="text-sky-700 underline">
              guided wizard
            </Link>
            ), or{' '}
            <Link to="/capture" className="text-sky-700 underline">
              capture
            </Link>{' '}
            spoken observations and route them in.
          </li>
          <li>
            Start in <span className="font-medium">Quick</span> depth to keep it
            short; raise it for more detail. When ready,{' '}
            <Link to="/export" className="text-sky-700 underline">
              export
            </Link>
            .
          </li>
        </ol>
      </div>

      <p className="text-sm text-gray-500">
        Use the menu to jump to any section or subsection at any time. The worksheet
        is non-linear by design.
      </p>
    </div>
  )
}
