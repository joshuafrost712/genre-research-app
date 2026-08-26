/**
 * One presence subscription for the whole app, so the sidebar and the header agree
 * about who is in the room.
 *
 * Mounted once in `Layout`. Two components read it and both would otherwise open
 * their own channel, which is the same "five slightly different ideas of the
 * truth" problem `TeamProvider` exists to solve, with a websocket attached to
 * each copy.
 *
 * Presence is a decoration and behaves like one: everything here has a path where
 * it renders nothing and costs nothing. Signed out, no Supabase, a project nobody
 * has shared, `?sync=poll` — no channel opens, and the app is the app it was
 * before this shipped.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { joinPresence, leavePresence, onPresenceState, setPresenceNode } from '../lib/presence/channel'
import {
  derivePresence,
  PRESENCE_TTL_MS,
  type PresenceInput,
  type PresencePerson,
} from '../lib/presence/derive'
import { nodeIdFromPath } from '../lib/presence/route'
import { refreshMembers, useMemberLabels } from '../lib/team/people'
import { useSupabaseSession } from '../lib/supabase/session'
import { useLocale } from '../lib/i18n/LocaleContext'
import { useTeam } from './TeamProvider'

interface Value {
  /** Everyone else in this project right now. Never you. */
  people: PresencePerson[]
  /** Everyone on one node, or on any of several (a nav group aggregating its children). */
  peopleOn: (nodeIds: string[]) => PresencePerson[]
  /** A name for a dot. Always returns something sayable, never a bare uuid. */
  nameOf: (userId: string) => string
}

const EMPTY: Value = {
  people: [],
  peopleOn: () => [],
  nameOf: () => '',
}

const Ctx = createContext<Value>(EMPTY)

/**
 * How often the snapshot is recomputed with no new events arriving.
 *
 * The TTL in derive.ts can only expire a claim if something re-runs the
 * reduction, and a frozen peer sends nothing by definition. Well under the TTL so
 * a stale dot goes within a tick or two of deserving to.
 */
const SWEEP_MS = 15_000

/** An empty room: nobody on the roster, nobody claiming a tab. */
const EMPTY_INPUT: PresenceInput = { presence: {}, nodes: {} }

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useSupabaseSession()
  const { current } = useTeam()
  const { pathname } = useLocation()
  const { t } = useLocale()
  const [raw, setRaw] = useState<PresenceInput>(EMPTY_INPUT)
  const [sweep, setSweep] = useState(0)

  const userId = user?.id ?? null
  // A project the cloud does not know about has no members table row, so the
  // private channel would be refused by design. Waiting for `shared` keeps the
  // majority of sessions (one person, one worksheet) from opening a socket that
  // exists only to be turned away.
  const projectId = current?.shared ? current.projectId : null
  const labelFor = useMemberLabels(projectId)

  // BEFORE the join effect, deliberately: effects run in declaration order, so
  // this has already recorded where we are by the time the channel subscribes and
  // makes its first announcement. Reversed, every session's first dot lands
  // nowhere until the next navigation.
  useEffect(() => {
    setPresenceNode(nodeIdFromPath(pathname))
  }, [pathname])

  useEffect(() => {
    // Cleared HERE as well as inside leavePresence(), and that is not belt and
    // braces. `leavePresence()` announces the empty room through the listener
    // list, so it only reaches this component while this component is still
    // listening — and on a project switch the cleanup has already unsubscribed,
    // while the no-project branch below never subscribes at all. Without this
    // line the old team's dots and "N here now" keep rendering over the new
    // project until the TTL sweep expires them, up to three minutes later.
    setRaw(EMPTY_INPUT)
    if (!projectId || !userId) {
      leavePresence()
      return
    }
    const unsubscribe = onPresenceState(setRaw)
    void joinPresence(projectId, userId)
    return () => {
      unsubscribe()
      leavePresence()
    }
  }, [projectId, userId])

  useEffect(() => {
    const timer = window.setInterval(() => setSweep((n) => n + 1), SWEEP_MS)
    return () => window.clearInterval(timer)
  }, [])

  const snapshot = useMemo(() => {
    // `sweep` is the dependency that makes the TTL real; the reduction itself
    // reads the clock.
    void sweep
    return derivePresence(raw, { selfId: userId, ttlMs: PRESENCE_TTL_MS })
  }, [raw, userId, sweep])

  // Somebody is in the room whose name we do not have. The usual reason is the
  // ordinary one — they joined the team after this page loaded, so they were not
  // in the member list we fetched — and until something re-reads it they are
  // "Someone" for the rest of the session. Presence is the one feature where
  // that case is the norm rather than the exception, so it is the one that asks.
  // `refreshMembers` rate-limits itself, so an id that can never be resolved
  // (a member who left, an offline device) costs one call a minute, not one a
  // render.
  const unknown = snapshot.people.some((p) => !labelFor(p.userId).email)
  useEffect(() => {
    if (!projectId || !unknown) return
    void refreshMembers(projectId)
  }, [projectId, unknown])

  const peopleOn = useCallback(
    (nodeIds: string[]): PresencePerson[] => {
      if (nodeIds.length === 0) return []
      const seen = new Set<string>()
      const out: PresencePerson[] = []
      for (const nodeId of nodeIds) {
        for (const person of snapshot.byNode.get(nodeId) ?? []) {
          // A group row aggregates its children, and one person is on exactly one
          // node — but the same node can legitimately be listed twice (a group's
          // own landing plus its child list), so dedupe rather than trust the input.
          if (seen.has(person.userId)) continue
          seen.add(person.userId)
          out.push(person)
        }
      }
      return out
    },
    [snapshot],
  )

  const nameOf = useCallback(
    (userId: string): string => {
      const { label, email } = labelFor(userId)
      // A guess that reads as a name, then the exact address, then a word that is
      // true. Never the account uuid: it is not a name, and showing one would make
      // the room feel less human rather than more.
      return label ?? email ?? t('presence.someone')
    },
    [labelFor, t],
  )

  const value = useMemo<Value>(
    () => ({ people: snapshot.people, peopleOn, nameOf }),
    [snapshot.people, peopleOn, nameOf],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Presence, or a working empty answer.
 *
 * Returns the empty value outside a provider rather than throwing, unlike
 * `useTeam`. A missing provider must not be able to blank the sidebar: every
 * consumer here is a decoration on a control that has to keep working.
 */
export function usePresence(): Value {
  return useContext(Ctx)
}
