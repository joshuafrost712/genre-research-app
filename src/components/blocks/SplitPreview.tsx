/**
 * Confirm step for splitting a jot: shows exactly the segments that will be
 * created before anything is written. Presentational only — the caller runs
 * splitSegments and splitCapturedNote. Labels arrive as props because the
 * picker is translated (t()) while the Capture page is deliberately English;
 * a t() call here would translate one island of an untranslated page.
 */
export interface SplitLabels {
  /** Heading above the segment list. */
  title: string
  /** Confirm button, already interpolated ("Split into 3 jots"). */
  confirm: string
  cancel: string
  /** Shown when the jot already has insertions; already interpolated. */
  usedWarning?: string
}

export function SplitPreview({
  segments,
  labels,
  onConfirm,
  onCancel,
}: {
  segments: string[]
  labels: SplitLabels
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/60 p-2">
      <p className="text-xs font-medium text-gray-700">{labels.title}</p>
      {labels.usedWarning && (
        <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-800">
          {labels.usedWarning}
        </p>
      )}
      <ol className="mt-1.5 flex list-decimal flex-col gap-1 pl-5">
        {segments.map((s, i) => (
          <li key={i} className="whitespace-pre-wrap text-xs text-gray-700">
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700"
        >
          {labels.confirm}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
        >
          {labels.cancel}
        </button>
      </div>
    </div>
  )
}
