import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useAllEntries } from '../lib/storage/entries'
import { getMetaValue, setActiveGenre, setMetaValue } from '../lib/storage/appState'
import { findNode, navSubsectionOf } from '../lib/content/loader'
import { useCustomOptions } from '../lib/customOptions'
import {
  columnCatalog,
  DEFAULT_COLUMNS,
  purposeCoverage,
  summaryCell,
  type SummaryColumnDef,
} from '../lib/content/summarize'

/**
 * 1f: the genre summary table. Genres are rows, features are columns — the
 * at-a-glance comparison across everything the team has described. Columns can
 * be added, removed, and reordered; rows (genres) reorder too. Cells show the
 * one-line summary when one exists, otherwise a truncated answer with a "needs
 * summary" mark. The coverage panel shows which passage-purpose families the
 * inventory can already serve (one genre can serve several).
 */
export function GenreSummary() {
  const { ctx, reload } = useActiveContext()
  const navigate = useNavigate()
  const entries = useAllEntries(ctx)
  const genres = useLiveQuery(
    () => (ctx ? db.genres.where('project_id').equals(ctx.projectId).sortBy('created_at') : []),
    [ctx?.projectId],
  )
  const customPurposes = useCustomOptions(ctx?.projectId ?? '', 's1b.purpose_families')

  const [colIds, setColIds] = useState<string[] | null>(null)
  const [rowOrder, setRowOrder] = useState<string[] | null>(null)
  const [editingCols, setEditingCols] = useState(false)

  const projectId = ctx?.projectId
  useEffect(() => {
    if (!projectId) return
    void getMetaValue(`summaryCols:${projectId}`).then((v) =>
      setColIds(v ? (JSON.parse(v) as string[]) : DEFAULT_COLUMNS),
    )
    void getMetaValue(`summaryRows:${projectId}`).then((v) =>
      setRowOrder(v ? (JSON.parse(v) as string[]) : []),
    )
  }, [projectId])

  if (!ctx || entries === undefined || genres === undefined || colIds === null || rowOrder === null) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const catalog = columnCatalog()
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const cols = colIds.map((id) => byId.get(id)).filter((c): c is SummaryColumnDef => !!c)

  // Saved order first, then any genres created since, in creation order.
  const ordered = [
    ...rowOrder.map((id) => genres.find((g) => g.id === id)).filter((g): g is NonNullable<typeof g> => !!g),
    ...genres.filter((g) => !rowOrder.includes(g.id)),
  ]

  const saveCols = (next: string[]) => {
    setColIds(next)
    void setMetaValue(`summaryCols:${ctx.projectId}`, JSON.stringify(next))
  }
  const saveRows = (next: string[]) => {
    setRowOrder(next)
    void setMetaValue(`summaryRows:${ctx.projectId}`, JSON.stringify(next))
  }
  const moveRow = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((g) => g.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    saveRows(ids)
  }

  const openGenreField = async (genreId: string, colId: string) => {
    await setActiveGenre(ctx.projectId, genreId)
    reload()
    const sub = colId.startsWith('__') ? 's3a' : (navSubsectionOf(colId) ?? 's1b')
    navigate(`/worksheet/${sub}`)
  }

  const coverage = purposeCoverage(entries, ordered, customPurposes)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="text-sm text-sky-700 hover:underline">
          ← Home
        </Link>
        <h1
          className="mt-1 text-2xl font-semibold"
          data-dfb-node="chrome.summary"
          data-dfb-field="label"
        >
          {findNode('chrome.summary')?.node.label ?? '1f: Genre Summary Table'}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          All your genres side by side. Tap a cell to open that genre's page. Cells marked{' '}
          <span className="font-medium text-amber-600">▲</span> have a long answer that still
          needs a one-line summary for this table.
        </p>
      </div>

      <CoveragePanel coverage={coverage} />

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700">
          {ordered.length} {ordered.length === 1 ? 'genre' : 'genres'} · {cols.length} columns
        </h2>
        <button
          type="button"
          onClick={() => setEditingCols((v) => !v)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          {editingCols ? 'Done' : 'Edit columns'}
        </button>
      </div>

      {editingCols && (
        <ColumnManager catalog={catalog} chosen={colIds} onChange={saveCols} />
      )}

      {ordered.length === 0 ? (
        <p className="text-sm text-gray-500">
          No genres yet.{' '}
          <Link to="/worksheet/s1a" className="text-sky-700 hover:underline">
            Start your genre list (1a) →
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 font-semibold text-gray-700">
                  Genre
                </th>
                {cols.map((c) => (
                  <th key={c.id} className="max-w-56 min-w-40 px-3 py-2 align-top font-medium text-gray-600">
                    <div>{c.label}</div>
                    <div className="text-[10px] font-normal text-gray-400">{c.subLabel}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map((g, gi) => (
                <tr key={g.id} className="border-b border-gray-100 align-top last:border-0">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-gray-900">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void openGenreField(g.id, 's1b.content')}
                        className="text-left hover:underline"
                      >
                        {g.name}
                      </button>
                      <span className="flex flex-col text-[10px] leading-none text-gray-300">
                        <button
                          type="button"
                          aria-label="Move up"
                          onClick={() => moveRow(g.id, -1)}
                          disabled={gi === 0}
                          className="hover:text-gray-600 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          onClick={() => moveRow(g.id, 1)}
                          disabled={gi === ordered.length - 1}
                          className="hover:text-gray-600 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
                    </div>
                  </th>
                  {cols.map((c) => {
                    const cell = summaryCell(
                      entries,
                      g.id,
                      c.id,
                      c.id === 's1b.purpose_families' ? customPurposes : undefined,
                    )
                    return (
                      <td key={c.id} className="max-w-56 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => void openGenreField(g.id, c.id)}
                          className="block w-full text-left text-gray-700 hover:text-gray-900"
                          title={cell.missingSummary ? 'Long answer — add a one-line summary' : undefined}
                        >
                          {cell.text ? (
                            <span className="whitespace-pre-wrap">
                              {cell.missingSummary && (
                                <span className="mr-1 font-medium text-amber-600">▲</span>
                              )}
                              {cell.text}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CoveragePanel({
  coverage,
}: {
  coverage: Array<{ id: string; label: string; genreNames: string[] }>
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-700">Purpose coverage</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Which purposes your genres can already serve (from 1b). One genre can serve several. Aim
        for at least one genre for each purpose family you plan to translate.
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {coverage.map((f) => (
          <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                f.genreNames.length === 0
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {f.genreNames.length}
            </span>
            <span className="font-medium text-gray-800">{f.label}</span>
            {f.genreNames.length === 0 ? (
              <span className="text-xs text-amber-700">no candidate genres yet</span>
            ) : (
              <span className="text-xs text-gray-500">{f.genreNames.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ColumnManager({
  catalog,
  chosen,
  onChange,
}: {
  catalog: SummaryColumnDef[]
  chosen: string[]
  onChange: (next: string[]) => void
}) {
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const move = (id: string, dir: -1 | 1) => {
    const i = chosen.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= chosen.length) return
    const next = [...chosen]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  // Available columns grouped by their page, for a scannable picker.
  const groups = new Map<string, SummaryColumnDef[]>()
  for (const c of catalog) {
    if (chosen.includes(c.id)) continue
    const list = groups.get(c.subLabel) ?? []
    list.push(c)
    groups.set(c.subLabel, list)
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Showing (in order)</h3>
        <ul className="mt-2 flex flex-col gap-1">
          {chosen.map((id, i) => {
            const c = byId.get(id)
            if (!c) return null
            return (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="flex gap-1">
                  <button
                    type="button"
                    aria-label="Move column left"
                    onClick={() => move(id, -1)}
                    disabled={i === 0}
                    className="rounded bg-gray-100 px-1.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    aria-label="Move column right"
                    onClick={() => move(id, 1)}
                    disabled={i === chosen.length - 1}
                    className="rounded bg-gray-100 px-1.5 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                  >
                    →
                  </button>
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {c.label} <span className="text-xs text-gray-400">({c.subLabel})</span>
                </span>
                <button
                  type="button"
                  onClick={() => onChange(chosen.filter((x) => x !== id))}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  remove
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-700">Add a column</h3>
        <div className="mt-2 flex flex-col gap-2">
          {[...groups.entries()].map(([groupLabel, items]) => (
            <div key={groupLabel}>
              <div className="text-xs font-medium text-gray-400">{groupLabel}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onChange([...chosen, c.id])}
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    + {c.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
