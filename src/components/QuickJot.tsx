import { useState } from 'react'
import { createCapturedNote } from '../lib/storage/notes'
import { useActiveContext } from './ActiveContextProvider'

/**
 * A floating "Jot" button available on every page. Katie's note: while filling
 * in one field a thought often surfaces about another part of the work, and
 * leaving the page to write it down breaks the train of thought. This captures
 * the thought as a note without navigating away. The note lands in Quick note /
 * AI routing, where it can be sorted to the right place later. Nothing about the
 * page the user is on changes.
 */
export function QuickJot() {
  const { ctx } = useActiveContext()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)

  if (!ctx) return null

  const save = async () => {
    const t = text.trim()
    if (!t) return
    await createCapturedNote(ctx, t)
    setText('')
    setSaved(true)
  }

  const close = () => {
    setOpen(false)
    setSaved(false)
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Jot a quick thought"
          className="fixed bottom-5 right-5 z-30 flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-3 text-sm font-medium text-white shadow-lg hover:bg-violet-700"
        >
          <span aria-hidden>✎</span> Jot
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-30 w-[min(20rem,calc(100vw-2.5rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">Quick jot</h2>
            <button
              type="button"
              onClick={close}
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              Close
            </button>
          </div>
          <p className="mb-2 text-[11px] text-gray-500">
            Write a thought without leaving this page. It is saved as a note you can
            sort to the right place later.
          </p>
          <textarea
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (saved) setSaved(false)
            }}
            placeholder="Dictate or type the thought…"
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!text.trim()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40"
            >
              Save note
            </button>
            {saved && <span className="text-xs text-emerald-600">Saved. Jot another or close.</span>}
          </div>
        </div>
      )}
    </>
  )
}
