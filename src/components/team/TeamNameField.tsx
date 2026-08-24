/**
 * The field that did not exist, which is why the whole feature was unusable.
 *
 * Until now nothing in the app could set a project's name: every worksheet was
 * born "Untitled project" and stayed that way for life, so a team list was a
 * column of identical rows. This is the one control that fixes it, and it appears
 * in three places (Home, the team page, the share gate) so nobody has to go
 * looking for it.
 *
 * An unnamed team is styled as something to DO, not as a neutral label. That is
 * deliberate: the naming is the part people skipped.
 */
import { useEffect, useState } from 'react'
import { useTeam } from '../TeamProvider'

export function TeamNameField() {
  const { current, rename } = useTeam()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reflect a rename from another device rather than holding a stale draft.
  useEffect(() => {
    if (!editing) setDraft(current?.named ? current.name : '')
  }, [current?.name, current?.named, editing])

  if (!current) return null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await rename(draft)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that name.')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          {current.named ? (
            <span className="text-base font-semibold text-gray-900">{current.name}</span>
          ) : (
            <span className="text-base font-semibold text-amber-800">No name yet</span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            {current.named ? 'Rename' : 'Give it a name'}
          </button>
        </div>
        {!current.named && (
          <p className="mt-1 text-xs text-amber-800">
            Name it so your team can tell it apart from the others. Any language is fine.
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <input
          value={draft}
          // Focus on entering edit mode: this is a one-field form somebody opened
          // on purpose, and on a phone it saves a second tap.
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) void save()
            if (e.key === 'Escape') setEditing(false)
          }}
          maxLength={80}
          placeholder="e.g. Walak team"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={busy || !draft.trim()}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
      {current.shared && (
        <p className="mt-1 text-xs text-gray-500">Everyone on the team sees this name.</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
