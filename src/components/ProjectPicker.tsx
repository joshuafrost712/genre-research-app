/**
 * Switch between projects, shown in the account menu once there is more than one.
 *
 * It earns its place the moment cloud sync exists. Before, a browser had exactly
 * one project and nowhere else to go. Now someone can arrive with local work in
 * this browser and a synced project from another, and without a way to move
 * between them one of the two is simply unreachable: the data is on the device,
 * intact, and invisible. That reads as lost work.
 *
 * Local-only projects are listed alongside synced ones and labelled, so "why is
 * this one not on my phone" has a visible answer rather than being a mystery.
 */
import { useEffect, useState } from 'react'
import { db } from '../lib/storage/db'
import { getActiveProjectId } from '../lib/storage/appState'
import { switchToProject } from '../lib/sync/adopt'
import { listMyProjects, publishProject } from '../lib/sync/supabase/projects'
import { syncEngine } from '../lib/sync/engine'
import { useSupabaseSession } from '../lib/supabase/session'

interface Row {
  id: string
  name: string
  synced: boolean
  entries: number
}

export function ProjectPicker({ onDone }: { onDone?: () => void }) {
  const { user } = useSupabaseSession()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [activeId, setActiveId] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const [projects, active, mine] = await Promise.all([
      db.projects.toArray(),
      getActiveProjectId(),
      user ? listMyProjects(true).catch(() => []) : Promise.resolve([]),
    ])
    const syncedIds = new Set(mine.map((p) => p.project_id))
    const withCounts = await Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name || 'Untitled project',
        synced: syncedIds.has(p.id),
        entries: await db.entries.where('project_id').equals(p.id).count(),
      })),
    )
    withCounts.sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name))
    setRows(withCounts)
    setActiveId(active)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!rows || rows.length < 2) return null

  const choose = async (id: string) => {
    if (id === activeId) return
    setBusy(id)
    try {
      await switchToProject(id)
      setActiveId(id)
      syncEngine.syncNow()
      onDone?.()
    } finally {
      setBusy(null)
    }
  }

  const publish = async (row: Row) => {
    setBusy(row.id)
    setError(null)
    try {
      await publishProject(row.id, row.name)
      syncEngine.syncNow()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sync that project.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="border-t border-gray-100 py-1">
      <div className="px-3 py-1 text-xs font-medium text-gray-500">Projects</div>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => choose(row.id)}
            disabled={busy !== null}
            className={`flex-1 rounded px-2 py-1.5 text-left text-sm hover:bg-gray-100 disabled:opacity-50 ${
              row.id === activeId ? 'font-medium text-sky-800' : 'text-gray-700'
            }`}
          >
            <span className="block truncate">
              {row.id === activeId ? '✓ ' : ''}
              {row.name}
            </span>
            <span className="block text-xs text-gray-500">
              {row.entries} answer{row.entries === 1 ? '' : 's'}
              {row.synced ? ' · synced' : ' · this device only'}
            </span>
          </button>
          {user && !row.synced && (
            <button
              type="button"
              onClick={() => publish(row)}
              disabled={busy !== null}
              className="mr-1 shrink-0 rounded border border-sky-300 px-2 py-1 text-xs text-sky-700 hover:bg-sky-50 disabled:opacity-50"
              title="Copy this project to your account so it appears on your other devices"
            >
              {busy === row.id ? '…' : 'Sync'}
            </button>
          )}
        </div>
      ))}
      {error && <div className="px-3 py-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}
