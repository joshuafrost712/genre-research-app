/**
 * "Bring in earlier work" — the workshop's missing move. Someone worked for days
 * in their own worksheet, their team now exists, and their work must become part
 * of the team's data instead of stranded in a project nobody looks at.
 *
 * Preview before write: the confirm step shows counts computed by a DRY RUN of
 * the same function that will do the import, so what it promises is exactly what
 * happens. The rules a person must know are stated right there: existing team
 * answers are never overwritten (a clash appends below, marked with where it
 * came from), recordings stay on this device, and one person imports at a time.
 */
import { useEffect, useState } from 'react'
import {
  importProjectInto,
  listImportSources,
  type ImportCounts,
  type ImportSource,
} from '../../lib/team/importWork'
import { describePassages } from '../../lib/team/describe'
import { syncEngine } from '../../lib/sync/engine'

type Step =
  | { at: 'closed' }
  | { at: 'pick'; sources: ImportSource[] }
  | { at: 'confirm'; source: ImportSource; preview: ImportCounts }
  | { at: 'busy' }
  | { at: 'done'; counts: ImportCounts }

export function ImportWork({
  targetId,
  teamName,
  onImported,
}: {
  targetId: string
  teamName: string
  /** Called after a successful import so the host can reload/refresh. */
  onImported?: () => void
}) {
  const [step, setStep] = useState<Step>({ at: 'closed' })
  const [hasSources, setHasSources] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The button only appears when there is actually something to bring in.
  useEffect(() => {
    let active = true
    void listImportSources(targetId).then((s) => {
      if (active) setHasSources(s.length > 0)
    })
    return () => {
      active = false
    }
  }, [targetId, step.at])

  if (!hasSources && step.at === 'closed') return null

  const open = async () => {
    setError(null)
    const sources = await listImportSources(targetId)
    setStep({ at: 'pick', sources })
  }

  const pick = async (source: ImportSource) => {
    setError(null)
    setStep({ at: 'busy' })
    try {
      const preview = await importProjectInto(source.projectId, targetId, { dryRun: true })
      setStep({ at: 'confirm', source, preview })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that worksheet.')
      setStep({ at: 'closed' })
    }
  }

  const run = async (source: ImportSource) => {
    setError(null)
    setStep({ at: 'busy' })
    try {
      const counts = await importProjectInto(source.projectId, targetId)
      syncEngine.syncNow()
      setStep({ at: 'done', counts })
      onImported?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import did not finish. Nothing was lost.')
      setStep({ at: 'closed' })
    }
  }

  const summarize = (c: ImportCounts) => {
    const bits: string[] = []
    if (c.answers) bits.push(`${c.answers} answer${c.answers === 1 ? '' : 's'}`)
    if (c.genres) bits.push(`${c.genres} new genre${c.genres === 1 ? '' : 's'}`)
    if (c.passages) bits.push(`${c.passages} new passage${c.passages === 1 ? '' : 's'}`)
    return bits.length ? bits.join(', ') : 'nothing new — it is already all here'
  }

  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      {step.at === 'closed' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-700">
            Worked in another worksheet before joining? Its answers can become part of{' '}
            <span className="font-medium">{teamName}</span>.
          </p>
          <button
            type="button"
            onClick={open}
            className="rounded border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50"
          >
            Bring in earlier work
          </button>
        </div>
      )}

      {step.at === 'pick' && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Bring in work from…</h3>
          <ul className="mt-2 divide-y divide-gray-100">
            {step.sources.map((s) => (
              <li key={s.projectId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{s.name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {describePassages(s.passages)} · {s.answerCount} answer
                    {s.answerCount === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className="shrink-0 rounded border border-sky-300 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50"
                >
                  Preview
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setStep({ at: 'closed' })}
            className="mt-2 text-xs text-gray-500 underline"
          >
            Cancel
          </button>
        </div>
      )}

      {step.at === 'confirm' && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Bring “{step.source.name}” into {teamName}?
          </h3>
          <p className="mt-2 text-sm text-gray-700">
            This will add {summarize(step.preview)}
            {step.preview.appended > 0 && (
              <>
                {' '}
                — {step.preview.appended} of them where the team already answered, so both
                answers will sit in the cell, the imported one marked with where it came from
              </>
            )}
            .
          </p>
          <ul className="mt-2 list-disc pl-5 text-xs text-gray-500">
            <li>Nothing the team has written is overwritten or deleted.</li>
            <li>Your old worksheet is not changed; you can still switch back to it.</li>
            <li>Voice recordings stay on this device; only written answers transfer.</li>
            <li>If a teammate is importing too, take turns — one import at a time.</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => run(step.source)}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            >
              Bring it in
            </button>
            <button
              type="button"
              onClick={() => setStep({ at: 'closed' })}
              className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step.at === 'busy' && <p className="text-sm text-gray-500">Working…</p>}

      {step.at === 'done' && (
        <div>
          <p className="text-sm text-emerald-700">
            Done: {summarize(step.counts)}
            {step.counts.appended > 0 &&
              `, ${step.counts.appended} added below existing team answers`}
            {step.counts.skipped > 0 &&
              `. ${step.counts.skipped} very old answer${step.counts.skipped === 1 ? '' : 's'} no longer fit the worksheet and stayed behind`}
            . The team receives it on their next sync.
          </p>
          <button
            type="button"
            onClick={() => setStep({ at: 'closed' })}
            className="mt-2 text-xs text-gray-500 underline"
          >
            Close
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
