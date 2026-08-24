/**
 * One answer to "which team am I in, and who else is in it", shared by every
 * surface that shows it.
 *
 * Five components need this now (the header chip, the drift banner, the Home
 * card, the team page, the genres page). Each calling `my_projects()` for itself
 * would mean five RPCs on every render pass and five slightly different ideas of
 * the truth, which is the class of bug this whole change exists to remove.
 *
 * Name resolution is the one rule worth stating: for a team the cloud knows
 * about, the SERVER name wins. It is what every other member's list shows, so a
 * device preferring its own replicated copy would be the one screen in the room
 * disagreeing about what the team is called.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { db } from '../lib/storage/db'
import { isNamedProject, UNNAMED_PROJECT } from '../lib/storage/appState'
import { listMyProjects, renameSharedProject } from '../lib/sync/supabase/projects'
import { useSupabaseSession } from '../lib/supabase/session'
import { renameTeam } from '../lib/team/rename'
import { useActiveContext } from './ActiveContextProvider'

export interface TeamSummary {
  projectId: string
  /** Resolved for display: server name for a shared team, local name otherwise. */
  name: string
  /** False while the name is still the placeholder every project is born with. */
  named: boolean
  /** Whether the cloud knows about it, i.e. whether anything here can be shared. */
  shared: boolean
  memberCount: number
  role: 'owner' | 'member' | null
  joinCode: string | null
  passages: string[]
  answers: number
}

interface Value {
  /** False until the first load resolves, so UI can avoid flashing "not shared". */
  ready: boolean
  configured: boolean
  signedIn: boolean
  /** The team the person is standing in. Null only before the first load. */
  current: TeamSummary | null
  /** Every team and worksheet this device can switch to, current one included. */
  all: TeamSummary[]
  /** Shared teams other than the current one — what "switch team" offers. */
  otherTeams: TeamSummary[]
  refresh: () => void
  rename: (name: string) => Promise<void>
}

const Ctx = createContext<Value | null>(null)

/**
 * Ten seconds, against a fifteen-second cache in listMyProjects.
 *
 * So this costs roughly one RPC per fifteen seconds and picks up a teammate
 * renaming the team, or a fifth person joining, without anybody reloading. The
 * three-second sync poll is for answers, where lag is felt; a team's name
 * changing once is not that.
 */
const REFRESH_MS = 10_000

export function TeamProvider({ children }: { children: ReactNode }) {
  const { ctx } = useActiveContext()
  const { configured, user } = useSupabaseSession()
  const [all, setAll] = useState<TeamSummary[]>([])
  const [ready, setReady] = useState(false)
  const [tick, setTick] = useState(0)
  // Projects whose name this device has already tried to push up. Without it the
  // self-heal below would fire on every ten-second pass.
  const healed = useRef<Set<string>>(new Set())

  const activeId = ctx?.projectId
  // A boolean, not the user object: the load only needs to know whether there is
  // an account to ask the server about, and depending on the identity rather than
  // the object keeps the effect from re-running on every auth refresh.
  const signedIn = !!user
  const userId = user?.id

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const [projects, shared] = await Promise.all([
        db.projects.toArray(),
        signedIn ? listMyProjects().catch(() => []) : Promise.resolve([]),
      ])
      const byId = new Map(shared.map((s) => [s.project_id, s]))

      const rows = await Promise.all(
        projects.map(async (p): Promise<TeamSummary> => {
          const s = byId.get(p.id)
          // Server name wins for a shared team, but only when it is a real name:
          // every team published before this build has "Untitled project" sitting
          // in that column, and preferring it would hide a local name somebody
          // has since typed.
          const serverNamed = isNamedProject(s?.name)
          const localNamed = isNamedProject(p.name)
          const name = serverNamed ? s!.name : localNamed ? p.name : UNNAMED_PROJECT

          return {
            projectId: p.id,
            name,
            named: serverNamed || localNamed,
            shared: !!s,
            memberCount: s?.member_count ?? 1,
            role: s?.role ?? null,
            joinCode: s?.join_code ?? null,
            passages: (await db.focusTexts.where('project_id').equals(p.id).toArray())
              .map((f) => (f.reference ?? '').trim())
              .filter((r) => r && r !== 'Untitled focus text'),
            answers: await db.entries.where('project_id').equals(p.id).count(),
          }
        }),
      )

      if (cancelled) return
      setAll(rows)
      setReady(true)

      // Self-heal the workshop's existing teams. A team named on this device
      // before the rename RPC existed has a good local name and "Untitled
      // project" on the server, where everyone else reads it. Push it up once.
      for (const row of rows) {
        if (!row.shared || healed.current.has(row.projectId)) continue
        const s = byId.get(row.projectId)
        if (isNamedProject(s?.name) || !isNamedProject(row.name)) continue
        healed.current.add(row.projectId)
        renameSharedProject(row.projectId, row.name).catch(() => {
          // Not fatal and not retried: the person can rename by hand, and a
          // retry loop over a permission error is worse than a stale label.
        })
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [signedIn, userId, activeId, tick])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const current = all.find((t) => t.projectId === activeId) ?? null

  const rename = useCallback(
    async (name: string) => {
      if (!activeId) throw new Error('No worksheet is open yet.')
      await renameTeam(activeId, name, { shared: current?.shared ?? false })
      refresh()
    },
    [activeId, current?.shared, refresh],
  )

  return (
    <Ctx.Provider
      value={{
        ready,
        configured,
        signedIn: !!user,
        current,
        all,
        otherTeams: all.filter((t) => t.shared && t.projectId !== activeId),
        refresh,
        rename,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useTeam(): Value {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTeam must be used within a TeamProvider')
  return v
}
