import { Link } from 'react-router-dom'
import { workspaces } from '../lib/content/loader'

/**
 * The workflow overview as a clean one-pager for printing or projecting: the
 * two workspaces with every stage and its one-line purpose. The Layout hides
 * the app chrome under `print:`, so the browser's Print gives a clean sheet
 * for workshops and for orienting people afterward.
 */
export function PrintChart() {
  const [w1, w2] = workspaces()

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <Link to="/" className="text-sm text-sky-700 hover:underline">
          ← Home
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Print
        </button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Local Genres Research — the workflow</h1>
        <p className="mt-1 text-sm text-gray-600">
          Two workspaces: learn your people's genres first, then create with them.
        </p>
      </div>

      {[w1, w2].map((ws, i) => (
        <section key={ws.id} className="break-inside-avoid rounded-xl border border-gray-300 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Workspace {i + 1}
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{ws.title}</h2>
          <p className="mb-3 mt-0.5 text-xs text-gray-600">{ws.blurb}</p>
          <ol className="flex flex-col gap-1.5">
            {ws.stages.map((stage) => {
              const sep = stage.title.indexOf(' — ')
              const letters = sep === -1 ? '•' : stage.title.slice(0, sep)
              const title = sep === -1 ? stage.title : stage.title.slice(sep + 3)
              return (
                <li key={stage.id} className="flex items-baseline gap-2.5">
                  <span className="w-14 shrink-0 text-right text-xs font-bold text-gray-700">
                    {letters}
                  </span>
                  <span className="text-sm">
                    <span className="font-medium text-gray-900">{title}.</span>{' '}
                    <span className="text-gray-600">{stage.blurb}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          {i === 0 && (
            <p className="mt-3 border-t border-dashed border-gray-300 pt-2 text-xs text-gray-500">
              ↓ Everything described here is reusable: it feeds every passage taken into
              Workspace 2.
            </p>
          )}
        </section>
      ))}

      <p className="text-xs text-gray-500">
        Workspace 1 stands on its own: a team can research genres without naming a passage.
        Workspace 2 needs Workspace 1's data. Work in any order within a workspace; the app keeps
        everything saved as you go.
      </p>
    </div>
  )
}
