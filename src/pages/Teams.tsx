/**
 * Shared worksheets: share the one you have open, or join someone else's by code.
 *
 * Replaces the Google Drive version, which needed the restricted full-`drive`
 * OAuth scope, only worked for personal Google accounts, and took 25 to 48
 * seconds to show a teammate's answer. This runs on the same Postgres sync every
 * signed-in device already uses, so a team is simply a project with more than one
 * member.
 *
 * The page deliberately leads with the operational rule rather than burying it:
 * one person sets the worksheet up and shares the code, everyone else joins. A
 * member who shares their own project instead ends up with a second worksheet
 * that looks identical and contains nobody else's work.
 */
import { useCallback, useEffect, useState } from 'react'
import { useActiveContext } from '../components/ActiveContextProvider'
import { db } from '../lib/storage/db'
import { useSupabaseSession } from '../lib/supabase/session'
import { listMyProjects, type SharedProject } from '../lib/sync/supabase/projects'
import { joinAndAdopt, shareActiveProject } from '../lib/sync/team'
import { switchToProject } from '../lib/sync/adopt'
import { syncEngine } from '../lib/sync/engine'
import { openAccountDialog } from '../components/account/dialogStore'

export function Teams() {
  const { ctx, reload } = useActiveContext()
  const { configured, user } = useSupabaseSession()

  const [mine, setMine] = useState<SharedProject[]>([])
  const [projectName, setProjectName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user) {
      setMine([])
      return
    }
    try {
      setMine(await listMyProjects(true))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your worksheets.')
    }
    if (ctx?.projectId) {
      setProjectName((await db.projects.get(ctx.projectId))?.name ?? '')
    }
  }, [user, ctx?.projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!configured) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="text-xl font-semibold">Shared worksheets</h1>
        <p className="mt-3 text-sm text-gray-600">
          This build has no cloud sync configured, so the app runs entirely on this device.
        </p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="text-xl font-semibold">Shared worksheets</h1>
        <p className="mt-3 text-sm text-gray-600">
          Sign in first. Sharing works with any email address; nothing here needs Google.
        </p>
        <button
          type="button"
          onClick={() => openAccountDialog('signin')}
          className="mt-3 rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
        >
          Sign in
        </button>
      </div>
    )
  }

  const activeShared = mine.find((p) => p.project_id === ctx?.projectId)

  const share = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await shareActiveProject()
      syncEngine.syncNow()
      await refresh()
      setNotice('Shared. Give the code below to your team.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share this worksheet.')
    } finally {
      setBusy(false)
    }
  }

  const join = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await joinAndAdopt(code)
      setCode('')
      reload()
      syncEngine.syncNow()
      await refresh()
      setNotice(
        res.applied > 0
          ? `Joined ${res.name || 'the worksheet'}. Your screen is now showing the team's work.`
          : `Joined ${res.name || 'the worksheet'}. Nobody has typed anything yet.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  const open = async (projectId: string) => {
    setBusy(true)
    try {
      await switchToProject(projectId)
      reload()
      syncEngine.syncNow()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setNotice('Code copied.')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">Shared worksheets</h1>
        <p className="mt-2 text-sm text-gray-600">
          Everyone on a shared worksheet sees each other's answers within a second or two, on
          any device, with any email address.
        </p>
      </div>

      <section className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">One person shares, everyone else joins.</p>
        <p className="mt-1">
          Set up the passage and the genres first, then share the code. If each person shares
          their own worksheet instead, you get several worksheets that look the same and hold
          different answers.
        </p>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">The worksheet you have open</h2>
        <p className="mt-1 text-sm text-gray-700">{projectName || 'Untitled project'}</p>

        {activeShared ? (
          <div className="mt-3">
            <p className="text-xs text-gray-500">
              Shared with {activeShared.member_count}{' '}
              {activeShared.member_count === 1 ? 'person (just you)' : 'people'}. Join code:
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded bg-gray-100 px-2 py-1 text-sm font-medium">
                {activeShared.join_code}
              </code>
              <button
                type="button"
                onClick={() => copy(activeShared.join_code)}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                Copy
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={share}
            disabled={busy}
            className="mt-3 rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? 'Sharing…' : 'Share this worksheet'}
          </button>
        )}
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Join a worksheet</h2>
        <p className="mt-1 text-xs text-gray-500">
          Type the code the facilitator gave you. Anything you have already written stays where
          it is; you can switch back to it below.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.trim()) void join()
            }}
            placeholder="summit-sorrel-violet-667"
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={join}
            disabled={busy || !code.trim()}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </section>

      {mine.length > 0 && (
        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Your shared worksheets</h2>
          <ul className="mt-2 divide-y divide-gray-100">
            {mine.map((p) => (
              <li key={p.project_id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-800">
                    {p.project_id === ctx?.projectId && (
                      <span className="text-sky-700">✓ </span>
                    )}
                    {p.name || 'Untitled project'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.member_count} {p.member_count === 1 ? 'member' : 'members'} · {p.role} ·{' '}
                    <code>{p.join_code}</code>
                  </p>
                </div>
                {p.project_id !== ctx?.projectId && (
                  <button
                    type="button"
                    onClick={() => open(p.project_id)}
                    disabled={busy}
                    className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <p className="text-xs text-gray-500">
        Voice recordings stay on the device that made them; they are not shared.
      </p>
    </div>
  )
}
