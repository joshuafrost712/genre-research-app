import { useCallback, useEffect, useState } from 'react'
import { useActiveContext } from '../components/ActiveContextProvider'
import { isGoogleConfigured } from '../lib/google/auth'
import { getAccount, type Account } from '../lib/google/account'
import {
  getProjectScopeKey,
  listTeams,
  moveProjectToScope,
  scopeKeyOf,
  setActiveScopeProject,
  type TeamRef,
} from '../lib/sync/scope'
import {
  buildJoinLink,
  createTeam,
  discoverTeams,
  inviteByEmail,
  leaveTeam,
  listMembers,
} from '../lib/sync/teams'
import { syncEngine } from '../lib/sync/engine'
import type { DrivePermission } from '../lib/google/drive'

/**
 * Teams: create a shared team, invite by email or copy a secret link, see who has
 * access, and move the current project into a team (or back to personal). Teams
 * are non-discoverable; there is no search or directory anywhere.
 */
export function Teams() {
  const { ctx, reload } = useActiveContext()
  const [account, setAccount] = useState<Account | null>(null)
  const [teams, setTeams] = useState<TeamRef[]>([])
  const [activeScopeKey, setActiveScopeKey] = useState<string>('personal')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newLink, setNewLink] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setAccount(await getAccount())
    setTeams(await listTeams())
    const pid = ctx?.projectId
    setActiveScopeKey(pid ? await getProjectScopeKey(pid) : 'personal')
  }, [ctx?.projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!isGoogleConfigured()) {
    return (
      <p className="text-sm text-gray-500">
        Teams need Google sign-in, which is not configured in this build.
      </p>
    )
  }
  if (!account) {
    return (
      <p className="text-sm text-gray-500">
        Sign in with Google (top right) to create or join a team.
      </p>
    )
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function onCreate() {
    if (!name.trim()) return
    await run(async () => {
      const team = await createTeam(name.trim())
      setName('')
      setNewLink(team.joinLink)
      await refresh()
    })
  }

  async function onDiscover() {
    await run(async () => {
      const found = await discoverTeams()
      await refresh()
      if (found.length === 0) {
        setError(
          'No new teams found. Make sure you accepted the Google Drive share sent to this account.',
        )
      } else {
        setNotice(
          `Added ${found.length === 1 ? `"${found[0].name}"` : `${found.length} teams`}. Open a team below to start syncing.`,
        )
      }
    })
  }

  async function moveCurrentTo(key: string) {
    if (!ctx) return
    await run(async () => {
      await moveProjectToScope(ctx.projectId, key)
      syncEngine.syncNow()
      await refresh()
    })
  }

  async function openTeam(team: TeamRef) {
    await run(async () => {
      const switched = await setActiveScopeProject(scopeKeyOf({ kind: 'team', ...team }))
      syncEngine.syncNow()
      reload()
      if (!switched) {
        setError(
          `No project in "${team.name}" yet. Move your current project into it, or create one while it is active.`,
        )
      }
      await refresh()
    })
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Teams</h1>
      <p className="text-sm text-gray-600">
        A team shares this project's data through a private Google Drive folder. Teams are
        never searchable: people can only join from an invite or a link you give them.
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Current project</h2>
        <p className="text-sm text-gray-600">
          Syncing to:{' '}
          <span className="font-medium">
            {activeScopeKey === 'personal'
              ? 'Personal (your Drive)'
              : (teams.find((t) => scopeKeyOf({ kind: 'team', ...t }) === activeScopeKey)?.name ??
                'a team')}
          </span>
        </p>
        {activeScopeKey !== 'personal' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => moveCurrentTo('personal')}
            className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            Move current project back to Personal
          </button>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Create a team</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Team name (e.g. a language name)"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={onCreate}
            className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
        {newLink && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-medium text-emerald-800">Team created. Share this private link:</p>
            <CopyLink link={newLink} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Join a team</h2>
        <p className="text-sm text-gray-600">
          Invited by email? After accepting the Google Drive share, click below to add the team
          here. (A join link someone sends you also works.)
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={onDiscover}
          className="self-start rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          Find teams shared with me
        </button>
        {notice && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
            {notice}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-gray-700">Your teams</h2>
        {teams.length === 0 && <p className="text-sm text-gray-400">No teams yet.</p>}
        {teams.map((team) => (
          <TeamCard
            key={team.folderId}
            team={team}
            busy={busy}
            isActive={activeScopeKey === scopeKeyOf({ kind: 'team', ...team })}
            onOpen={() => openTeam(team)}
            onMoveHere={() => moveCurrentTo(scopeKeyOf({ kind: 'team', ...team }))}
            onInvite={(email) => run(() => inviteByEmail(team.folderId, email))}
            onLeave={() => run(async () => { await leaveTeam(team.folderId); await refresh() })}
          />
        ))}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-1 flex items-center gap-2">
      <input
        readOnly
        value={link}
        className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(link)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }}
        className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function TeamCard({
  team,
  busy,
  isActive,
  onOpen,
  onMoveHere,
  onInvite,
  onLeave,
}: {
  team: TeamRef
  busy: boolean
  isActive: boolean
  onOpen: () => void
  onMoveHere: () => void
  onInvite: (email: string) => void
  onLeave: () => void
}) {
  const [email, setEmail] = useState('')
  const [members, setMembers] = useState<DrivePermission[] | null>(null)

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {team.name}
          {isActive && <span className="ml-2 text-[11px] font-medium text-emerald-600">active</span>}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onOpen}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
          >
            Open
          </button>
          <button
            type="button"
            disabled={busy || isActive}
            onClick={onMoveHere}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
          >
            Move current project here
          </button>
        </div>
      </div>

      {team.joinSecret && <CopyLink link={buildJoinLink(team.folderId, team.joinSecret)} />}

      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Invite by email"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={busy || !email.trim()}
          onClick={() => {
            onInvite(email.trim())
            setEmail('')
          }}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          Invite
        </button>
      </div>
      <p className="text-xs text-gray-400">
        After they accept the Drive email, they click "Find teams shared with me" to join here.
      </p>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <button
          type="button"
          disabled={busy}
          onClick={async () => setMembers(await listMembers(team.folderId))}
          className="hover:text-gray-800"
        >
          Show members
        </button>
        <button type="button" disabled={busy} onClick={onLeave} className="hover:text-red-600">
          Leave team
        </button>
      </div>
      {members && (
        <ul className="text-xs text-gray-600">
          {members.map((m) => (
            <li key={m.id}>
              {m.emailAddress ?? m.type} · {m.role}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
