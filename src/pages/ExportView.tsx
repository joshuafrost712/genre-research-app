import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useAllEntries } from '../lib/storage/entries'
import { buildAiPrompt, buildRows, toCsv, type ExportNames } from '../lib/export'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useDepthMode } from '../components/DepthModeContext'

/** Offline export: long-format CSV and an AI-synthesis prompt. */
export function ExportView() {
  const { ctx } = useActiveContext()
  const { mode } = useDepthMode()
  const entries = useAllEntries(ctx)
  const names = useLiveQuery(async (): Promise<ExportNames | null> => {
    if (!ctx) return null
    const [focusText, genre] = await Promise.all([
      db.focusTexts.get(ctx.focusTextId),
      db.genres.get(ctx.genreId),
    ])
    return { focusText: focusText?.reference ?? '—', genre: genre?.name ?? '—', mode }
  }, [ctx?.focusTextId, ctx?.genreId, mode])

  if (!ctx || entries === undefined || !names) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const rows = buildRows(entries, names)
  const slug = `${names.focusText}-${names.genre}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

  const download = (content: string, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Export</h1>
        <p className="mt-1 text-sm text-gray-500">
          {rows.length} answered cell{rows.length === 1 ? '' : 's'} for{' '}
          <span className="text-sky-700">{names.focusText}</span> ×{' '}
          <span className="text-emerald-700">{names.genre}</span>. Works offline, no
          account needed.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => download(toCsv(rows), `${slug}.csv`, 'text/csv')}
          className="rounded-lg bg-gray-800 px-4 py-3 text-left font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Download CSV
          <span className="block text-xs font-normal text-gray-300">
            One row per answered cell; grids and tables melt to long format.
          </span>
        </button>

        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() =>
            download(buildAiPrompt(rows, names), `${slug}-ai-prompt.txt`, 'text/plain')
          }
          className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-left font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40"
        >
          Download AI-synthesis prompt
          <span className="block text-xs font-normal text-gray-500">
            Paste into Claude with the CSV for translation recommendations.
          </span>
        </button>

        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-400">
          Export to Google Sheets (tab per section, matching Katie's layout)
          <span className="block text-xs">
            Coming next. Needs a Google OAuth client id configured for the
            client-side `drive.file` flow.
          </span>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-gray-500">
          Nothing to export yet. Answer some prompts first.
        </p>
      )}
    </div>
  )
}
