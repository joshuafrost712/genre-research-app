/**
 * The team page: which team you are in, who is on it, and how to move between them.
 *
 * A team is a project with more than one member. It runs on the same Postgres sync
 * every signed-in device already uses, which is why sharing is nearly instant and
 * needs no Google account.
 *
 * Rewritten after the OBT-CDT Psalms workshop, where several teams could not use
 * this feature at all. Three things were wrong, and only one of them was a bug:
 *
 *  1. Nothing in the app could set a project's name, so every row in every list
 *     read "Untitled project" and no team could find its own worksheet. The name
 *     also had to be pushed to the server, because this list reads
 *     `shared_projects.name`, not the replicated `projects` row.
 *  2. "4 members" hid the question people were actually asking, which is whether
 *     the four are the right four.
 *  3. The page called itself "Shared worksheets" while the menu said "Teams" and
 *     the data said "projects". One word now: team.
 *
 * The route stays /teams so join links and codes already handed out keep working.
 */
import { useCallback, useEffect, useState } from 'react'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useSupabaseSession } from '../lib/supabase/session'
import { joinAndAdopt, shareActiveProject } from '../lib/sync/team'
import { switchToProject } from '../lib/sync/adopt'
import { syncEngine } from '../lib/sync/engine'
import { openAccountDialog } from '../components/account/dialogStore'
import { useTeam } from '../components/TeamProvider'
import { TeamNameField } from '../components/team/TeamNameField'
import { TeamMembers } from '../components/team/TeamMembers'
import { JoinCodeRow } from '../components/team/JoinCodeRow'
import { describeMembers, describePassages } from '../lib/team/describe'

export function Teams() {
  const { reload } = useActiveContext()
  const { configured, user } = useSupabaseSession()
  const { ready, current, all, refresh } = useTeam()

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const after = useCallback(() => {
    reload()
    syncEngine.syncNow()
    refresh()
  }, [reload, refresh])

  // Clear a stale success message when the person moves to another team.
  useEffect(() => setNotice(null), [current?.projectId])

  if (!configured) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="mt-3 text-sm text-gray-600">
          This build has no cloud sync configured, so the app runs entirely on this device.
        </p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="mt-3 text-sm text-gray-600">
          Sign in first. Working in a team works with any email address; nothing here needs
          Google.
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

  const share = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await shareActiveProject()
      after()
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
      after()
      setNotice(
        res.applied > 0
          ? 'Joined. Your screen is now showing the team’s work.'
          : 'Joined. Nobody on the team has typed anything yet.',
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
      after()
    } finally {
      setBusy(false)
    }
  }

  const others = all.filter((t) => t.projectId !== current?.projectId)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="mt-2 text-sm text-gray-600">
          Everyone on a team shares one set of passages, genres and answers, and sees each
          other&apos;s work within a second or two, on any device.
        </p>
      </div>

      {/* Where you are. First, because it is the question the workshop could not
          answer, and because everything else on the page is relative to it. */}
      <section
        className={`rounded border p-4 ${
          current?.shared && current.memberCount > 1
            ? 'border-sky-200 bg-sky-50'
            : 'border-amber-200 bg-amber-50'
        }`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          You are working in
        </h2>

        {!ready || !current ? (
          <p className="mt-2 text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="mt-2 space-y-3">
            <TeamNameField />

            <p className="text-xs text-gray-600">{describePassages(current.passages)}</p>

            {current.shared ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  Shared with {describeMembers(current.memberCount)}.
                </p>
                <TeamMembers projectId={current.projectId} />
                <div>
                  <p className="text-xs text-gray-500">
                    Anyone with this code can join the team:
                  </p>
                  <div className="mt-1">
                    <JoinCodeRow code={current.joinCode ?? ''} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-amber-900">
                  This worksheet is yours alone. Nothing in it reaches anybody else.
                </p>
                {/* The naming gate. An unnamed team is the defect this whole page
                    exists to fix, so a new one is not allowed to be created. */}
                {current.named ? (
                  <button
                    type="button"
                    onClick={share}
                    disabled={busy}
                    className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {busy ? 'Sharing…' : 'Share it with my team'}
                  </button>
                ) : (
                  <p className="text-sm text-amber-900">
                    Give it a name first, then you can share it.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded border border-amber-200 bg-white p-3 text-sm text-amber-900">
        <p className="font-medium">One person shares, everyone else joins.</p>
        <p className="mt-1">
          Set up the passage and the genres first, then share the code. If each person shares
          their own worksheet instead, you get several teams that look the same and hold
          different answers.
        </p>
      </section>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Join a team</h2>
        <p className="mt-1 text-xs text-gray-500">
          Type the code your facilitator gave you. Anything you have already written stays
          where it is; you can switch back to it below.
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

      {others.length > 0 && (
        <section className="rounded border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Switch to another one</h2>
          <p className="mt-1 text-xs text-gray-500">
            Each of these holds its own passages, genres and answers. You only ever see the
            one you are in.
          </p>
          <ul className="mt-2 divide-y divide-gray-100">
            {others.map((t) => (
              <li key={t.projectId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-800">
                    {t.named ? t.name : 'No name yet'}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {t.shared ? describeMembers(t.memberCount) : 'this device only'} ·{' '}
                    {describePassages(t.passages)} · {t.answers}{' '}
                    {t.answers === 1 ? 'answer' : 'answers'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => open(t.projectId)}
                  disabled={busy}
                  className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Open
                </button>
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
