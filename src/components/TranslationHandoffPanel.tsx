import { useEffect, useState } from 'react'
import {
  buildTranslationBundle,
  importTranslationReply,
  type ImportResult,
} from '../lib/translate/handoff'
import { pendingCount } from '../lib/translate/queue'

/**
 * The zero-metered-cost translation lane, as an operator flow.
 *
 * Mirrors the note-routing panel on the same page: the app prepares a
 * self-contained bundle, Claude (on a Max subscription) does the work, the reply
 * comes back in. No key, no metered call, nothing new to deploy.
 *
 * Answers reach this queue either because the app is configured for the deferred
 * lane, or because an interactive translation could not be delivered (offline, rate
 * limited, no proxy configured). Either way the work is not lost.
 */
export function TranslationHandoffPanel() {
  const [count, setCount] = useState<number | null>(null)
  const [bundle, setBundle] = useState('')
  const [reply, setReply] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = () => pendingCount().then(setCount)
  useEffect(() => {
    void refresh()
  }, [])

  const prepare = async () => {
    const built = await buildTranslationBundle()
    setBundle(built.text)
    setMsg(built.count === 0 ? 'No answers are waiting for translation.' : null)
    if (built.count > 0) {
      try {
        await navigator.clipboard.writeText(built.text)
        setMsg(`Copied ${built.count} answer${built.count === 1 ? '' : 's'} to the clipboard.`)
      } catch {
        setMsg('Select the text below and copy it.')
      }
    }
  }

  const summarize = (r: ImportResult) => {
    const parts = [`Applied ${r.applied}`]
    // Surfaced rather than swallowed: a stale count is the operator's signal that
    // the team edited those answers while the batch was out, and they will need
    // translating again.
    if (r.stale) parts.push(`${r.stale} skipped (the answer changed since)`)
    if (r.missing) parts.push(`${r.missing} skipped (answer deleted)`)
    if (r.unmatched) parts.push(`${r.unmatched} did not match anything queued`)
    return `${parts.join(', ')}.`
  }

  const doImport = async () => {
    const result = await importTranslationReply(reply)
    if (result.applied + result.stale + result.missing + result.unmatched === 0) {
      setMsg("Could not find a JSON array in that reply — paste Claude's whole answer.")
      return
    }
    setMsg(summarize(result))
    setReply('')
    setBundle('')
    await refresh()
  }

  // Nothing queued and nothing in flight: stay out of the way.
  if (count === 0 && !bundle && !reply && !msg) return null

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="font-medium">Translate answers with Claude (no API cost)</h2>
      <p className="text-sm text-gray-500">
        {count === null
          ? 'Checking…'
          : `${count} answer${count === 1 ? '' : 's'} waiting to be translated.`}{' '}
        Prepare the bundle, paste it to Claude on your Max subscription, then paste the
        reply back. Nothing is sent anywhere by the app.
      </p>

      <button
        type="button"
        onClick={prepare}
        className="self-start rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Prepare answers for Claude
      </button>

      {bundle && (
        <textarea
          readOnly
          value={bundle}
          rows={6}
          className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}

      <label className="mt-2 text-xs text-gray-500">Paste Claude&apos;s JSON reply here</label>
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={4}
        placeholder='[{"seq": 1, "translation": "…"}]'
        className="w-full rounded-md border border-gray-300 p-2 font-mono text-xs focus:border-gray-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={doImport}
        disabled={!reply.trim()}
        className="self-start rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40"
      >
        Import translations
      </button>

      {msg && <p className="rounded-md bg-gray-100 p-3 text-sm text-gray-700">{msg}</p>}
    </section>
  )
}
