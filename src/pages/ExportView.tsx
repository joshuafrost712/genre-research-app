import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useAllEntries } from '../lib/storage/entries'
import { buildAiPrompt, buildRows, buildSheetTabs, toCsv, type ExportNames } from '../lib/export'
import { exportToGoogleSheets, isSheetsConfigured } from '../lib/googleSheets'
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

  const [sheetState, setSheetState] = useState<
    { status: 'idle' | 'working' } | { status: 'done'; url: string } | { status: 'error'; message: string }
  >({ status: 'idle' })
  const [docState, setDocState] = useState<'idle' | 'docx' | 'pdf'>('idle')

  if (!ctx || entries === undefined || !names) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const rows = buildRows(entries, names)
  const slug = `${names.focusText}-${names.genre}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase()

  const download = (content: Blob | string, filename: string, type: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // The document renderers (and their libraries) load only when used, keeping the
  // main bundle lean. The shared report model is built from the same rows.
  const downloadDoc = async (kind: 'docx' | 'pdf') => {
    setDocState(kind)
    try {
      const { buildReportModel } = await import('../lib/report/model')
      const model = buildReportModel(rows, names, { date: new Date().toLocaleDateString() })
      if (kind === 'docx') {
        const { buildDocx } = await import('../lib/report/docx')
        download(
          await buildDocx(model),
          `${slug}.docx`,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
      } else {
        const { buildPdf } = await import('../lib/report/pdf')
        download(await buildPdf(model), `${slug}.pdf`, 'application/pdf')
      }
    } finally {
      setDocState('idle')
    }
  }

  const exportSheets = async () => {
    setSheetState({ status: 'working' })
    try {
      const url = await exportToGoogleSheets(`Local Genres — ${slug}`, buildSheetTabs(rows, names))
      setSheetState({ status: 'done', url })
    } catch (e) {
      setSheetState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
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
          disabled={rows.length === 0 || docState !== 'idle'}
          onClick={() => downloadDoc('docx')}
          className="rounded-lg bg-sky-700 px-4 py-3 text-left font-medium text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {docState === 'docx' ? 'Preparing…' : 'Download Word document (.docx)'}
          <span className="block text-xs font-normal text-sky-100">
            A clean, formatted report: clear headings, each question with its
            answer. Opens in Microsoft Word.
          </span>
        </button>

        <button
          type="button"
          disabled={rows.length === 0 || docState !== 'idle'}
          onClick={() => downloadDoc('pdf')}
          className="rounded-lg bg-emerald-700 px-4 py-3 text-left font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
        >
          {docState === 'pdf' ? 'Preparing…' : 'Download PDF'}
          <span className="block text-xs font-normal text-emerald-100">
            The same formatted report as a PDF: ready to print or share, nothing
            to install.
          </span>
        </button>

        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => download(toCsv(rows), `${slug}.csv`, 'text/csv;charset=utf-8')}
          className="rounded-lg bg-gray-800 px-4 py-3 text-left font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Download spreadsheet data (CSV)
          <span className="block text-xs font-normal text-gray-300">
            One row per answered cell for Excel or analysis; grids and tables melt
            to long format.
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

        {isSheetsConfigured() ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={rows.length === 0 || sheetState.status === 'working'}
              onClick={exportSheets}
              className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-left font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40"
            >
              {sheetState.status === 'working' ? 'Exporting…' : 'Export to Google Sheets'}
              <span className="block text-xs font-normal text-gray-500">
                Tab per section, matching Katie's layout. Creates a sheet in your
                Drive (the app only sees files it creates).
              </span>
            </button>
            {sheetState.status === 'done' && (
              <a
                href={sheetState.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-sky-700 underline"
              >
                Open the exported spreadsheet →
              </a>
            )}
            {sheetState.status === 'error' && (
              <p className="text-sm text-red-600">{sheetState.message}</p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-400">
            Export to Google Sheets (tab per section, matching Katie's layout)
            <span className="block text-xs">
              Built and ready. Set VITE_GOOGLE_CLIENT_ID (a Google OAuth client id
              with the `drive.file` scope) in .env to enable it.
            </span>
          </div>
        )}
      </div>

      {rows.length === 0 && (
        <p className="text-sm text-gray-500">
          Nothing to export yet. Answer some prompts first.
        </p>
      )}
    </div>
  )
}
