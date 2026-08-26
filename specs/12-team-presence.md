# Spec 12 — Live team presence on the section tabs

**Request (Joshua, 2026-08-25):** show who is working where, so a team sharing
one worksheet can see each other instead of being warned about each other.

This is the second half of a two-part response to a field report. The first half
shipped as `cc2ad1b`: the overwrite toast used to fire for any remote change to
any answer already in this browser's copy of the data, so people who had typed
nothing were interrupted all morning. It now fires only for a genuine collision,
text this account typed within the last ten minutes, replaced by somebody else,
and it names the person.

That made the app quieter. This makes it companionable. The two are deliberately
separate: quieting a false alarm is a bug fix, and ambient presence is a feature
with a security surface, so it gets its own session and its own review.

**Status: the transport was rebuilt and all 50 browser checks pass (2026-08-26).**

The first build sent node changes over presence and died a minute into ordinary
navigation; see "The fifth thing" below, which is kept because the failure is the
reason the design looks the way it does. Joshua chose to move node changes to
`broadcast`, and that is what shipped: **presence answers who, broadcast answers
where.** Twelve consecutive navigations now land in ~615ms each, where the old
build froze permanently after four.

Built on `feature/spec-12-presence`. The authorization migration is applied to
the live project and proven from both sides by `scripts/verify-presence.mjs`
(14/14); it needed no change, because broadcast on a private channel is
authorised by the same `realtime.messages` INSERT policy presence uses. Lint,
`tsc`, 359 tests and the build are green.

### The design that shipped: two transports on one channel

| | Carries | How often | Why this one |
|---|---|---|---|
| **Presence** (`track`) | `{at}` | Once per join | Realtime drops the entry the instant the socket closes, so a closed tab disappears with no timeout. Nothing else does that. |
| **Broadcast** (`node`) | `{userId, nodeId, at}` | Per navigation (500ms debounce) + 60s heartbeat | A different limiter: `max_events_per_second: 100`. Verified at 40 sends in 18s with the channel untouched. |

Navigation no longer touches presence at all, which is why the rate limit that
killed the first build cannot be reached by using the feature. **Keep presence
off the hot path**: anything added to the presence payload has to answer how
often it changes before it goes in.

Three consequences the presence-only design got for free and this one has to earn:

1. **Broadcast keeps no history**, so a newcomer hears silence. Every peer
   re-announces when it sees a `join`, coalesced over 400ms so a room
   reconnecting together costs one message. Measured end to end: a newcomer
   learns where everybody is in ~1.4s, unprompted.
2. **Liveness moved to the broadcast heartbeat.** A person is counted if EITHER
   their roster stamp or their last claim is inside the TTL — the roster covers
   the newcomer who has not broadcast yet, the claim covers everyone else. The
   dot, though, needs a fresh claim: a stale one is released rather than left
   hanging on a page they may have left.
3. **There is deliberately no `leave` handler**, and that cost a debugging round.
   Dropping a peer's claim when they leave looks tidy and is wrong: a reload is a
   leave and a join, the presence diff is the slower of the two, and the handler
   deleted the fresh broadcast that had already arrived. The two-browser check
   caught it as "the host sees no dot but the header says 1 here now". The roster
   is already the authority on who is present, so nothing needs cleaning up.

The message budget is unchanged by the move: the heartbeat is still one message
per person per minute, just a broadcast rather than a track.

### The fifth thing: the presence rate limit closes the channel, it does not shed the event

`scripts/check-presence-live.mjs` walks the guest through five sections and
asserts the host's dot follows each time. Four land in ~620ms. The fifth never
arrives, and the wire says why:

```
[guest] receive error … system {"message":"Client presence rate limit exceeded","status":"error"}
[guest] receive … phx_close
[host]  receive presence_diff {"joins":{},"leaves":{… nodeId:"s0.setup"}}
        track#4 -> "timed out"   host.state=joined   guest.state=closed
```

Three things make this fatal rather than untidy:

1. **The limit is far lower than the tenant config advertises.** The project
   reports `max_presence_events_per_second: 20`. Measured against it, a client
   is killed on its **sixth** `track()` at any interval up to 5 seconds; only a
   10-second spacing survived. So the sustainable rate is about **one track per
   10 seconds**, not 20 per second. `presence_enabled` is `false` in that same
   config; flipping it to `true` changed nothing measurable, so it is not the
   lever, and it was set back.
2. **Navigation is what breaks it, and navigation is the feature.** The
   heartbeat at 60s is comfortably safe. But `setPresenceNode` re-tracks on every
   route change behind a 500ms debounce, and walking five sections in a minute is
   ordinary workshop behaviour, not stress.
3. **There is no recovery.** A server-initiated `phx_close` is not a socket
   error, so realtime-js does not rejoin, and `channel.ts` treats `CLOSED` as
   fail-open: it publishes `{}` and returns. The dots vanish, nothing is logged
   outside DEV, and presence stays dead until the tab is reloaded.

The spec's message-budget arithmetic counted heartbeats and never counted
navigation, which is why this was invisible on paper. The budget was never the
binding constraint; the per-client presence rate limit is.

**Resolved.** Option (b) was chosen and built: node changes moved to broadcast,
presence kept for the roster and for leave-on-disconnect. (a) throttling to one
track per 10s would have kept the design and lost the "within about a second"
promise; (c) rejoining on `CLOSED` alone only converts a dead channel into a
thrashing one. The `CLOSED` handler was tightened anyway, since the old one left
`joinedKey` set and the heartbeat talking to a dead socket, which blocked the
rejoin that would have fixed it.

## What done looks like

Two people in the same team, on different sections of the worksheet:

- Each sees a small dot with the other's name on the section the other is
  working in, in the sidebar (`NavShell`).
- The header shows how many other people are in the project right now.
- Navigating moves your dot within about a second.
- Closing the tab removes it.
- Somebody who is not on the team sees nothing and cannot join the channel.

## The three claims, answered against the live project (2026-08-25)

All three held, and the section did its job: checking them turned up a fourth
thing nobody had thought of, and it is the one that would have cost the session.

1. **`realtime.topic()` exists.** Its body is
   `nullif(current_setting('realtime.topic', true), '')::text`, so it returns
   NULL rather than raising when the topic is unset. The predicate handles NULL
   first because of that.
2. **`extension = 'presence'` was left out**, on the spec's own advice.
   `realtime.topic()` plus `is_member()` is the boundary, and the column exists
   (`text not null`) if a later spec ever wants it.
3. **`select` plus `insert` is the pair.** Realtime checks read authorization
   with a SELECT and write authorization with an INSERT, and write is what
   `track()` needs. `realtime.messages` already had RLS enabled with **zero**
   policies, so the baseline was deny-all rather than something to switch on.

**Migration route:** the Management API SQL endpoint, as `postgres`, exactly as
`scripts/enable-team-sync.sh` does it. `scripts/enable-presence.sh` is the
runnable form. Note that `postgres` is neither superuser nor a member of
`supabase_realtime_admin`, so `alter table realtime.messages ...` would fail
while `create policy` on it succeeds; the migration asserts the RLS state instead
of trying to set it.

### The fourth thing: Realtime's schema is created lazily, on first connection

This project's `realtime` schema was **empty** — no `realtime.messages`, no
`realtime.topic()`, no partitions — and `GET /v1/projects/{ref}/health` reported
realtime UNHEALTHY. Not a broken project: the app has never opened a channel, and
the Realtime service runs its own 81 DB migrations when a client first connects.
One public-channel probe provisioned the lot at 12:50:29 UTC, mid-investigation.

Two things follow, and both are now in the code:

- **The first private join during that boot window fails with
  `MissingPartition`**, which reads exactly like a broken authorization design.
  It is not. `enable-presence.sh` warms the tenant and waits for
  `realtime.messages` before applying anything.
- **A catalogue query run before the boot answers `[]`, not an error.** Two
  early queries here reported an empty `realtime` schema and were *correct at the
  time*; re-running them later returned 15 functions. Anything that concludes
  "this project cannot do realtime" has to say when it looked.

### And a trap in the harness, not the design

`createClient(url, key, { accessToken: () => jwt })` looks like the clean way to
drive a specific user in a test. It is not: supabase-js's initial
`realtime.setAuth()` is fire-and-forget in the constructor, so a `subscribe()`
on the next line joins the private channel **as anon** and Realtime refuses it
with the same "Unauthorized ... read from this Channel topic" a wrong RLS policy
produces. An hour went into auditing correct SQL. What isolated it was driving
both policies by hand — `set local role authenticated`, claims and topic set,
INSERT into `realtime.messages` — which passed, proving the database right and
the client wrong. `verify-presence.mjs` now signs in for real, which is also what
the app does.

## Design

### Transport

Supabase Realtime Presence. `@supabase/supabase-js` is already a dependency
(^2.108) and no realtime is used anywhere today, so this is new wiring rather
than a change to the sync engine.

New `src/lib/presence/channel.ts`:

```ts
supabase.channel(`presence:${projectId}`, {
  config: { private: true, presence: { key: userId }, broadcast: { self: false } },
})
```

**`private: true` is load-bearing and is not the default.**
`RealtimeChannel.js:94` defaults it to `false`, and line 440 is where it becomes
the `private=true` join parameter. RLS on `realtime.messages` is consulted only
for private channels, so without this flag the whole authorization migration
below is inert while appearing to be in force, and anyone holding the anon key
and a project uuid can read a team's presence — and now its broadcasts too.

- `track({ at })` ONCE, on subscribe. The payload is a timestamp and nothing
  else; see "The design that shipped" above for why `nodeId` is not in it.
- Broadcast `{ userId, nodeId, at }` on the `node` event for the worksheet node
  from the route, debounced about 500ms so walking the nav does not spray
  updates, plus a 60s heartbeat and a coalesced re-announce whenever a peer
  joins.
- `untrack()` and `removeChannel()` on unmount and on sign-out.
- No-op when Supabase is unconfigured or the user is signed out, the way
  `outbox.ts` and the sync engine already degrade.
- **No-op unless `syncMode() === 'live'`.** `mode.ts` documents `?sync=poll` as
  the escape hatch for when realtime misbehaves and `?sync=off` as local-only.
  Presence is the first feature that makes that distinction real, and a
  facilitator needs a way to switch it off in the room. `live` is the default,
  so presence ships on.

Do **not** hand-wire `supabase.realtime.setAuth()`. `supabase-js` calls it on
auth state change when the client is created without a custom `accessToken`
(`dist/index.mjs:849`), which is the case in `src/lib/supabase/client.ts`.
Confirm by watching a private channel join after sign-in, and add the call only
if it does not.

### Authorization

New migration `supabase/migrations/<ts>_presence_authorization.sql`: enable
Realtime Authorization and add RLS on `realtime.messages`, reusing
`public.is_member(uuid)` from `20260806000000_team_sync.sql`.

Derive the project id from the topic with a guarded parse. A topic that does not
match `presence:<uuid>` must fail closed, not raise a cast error.

### The indicator

`PresenceProvider` mounts once in `Layout.tsx` around the shell, so the sidebar
and the header share one subscription.

- **Section tabs.** In `NavShell.tsx`, each subsection `NavLink` (and each group
  row, aggregating its children) gets a small dot with a count when other people
  are on that node, and their names in the `title`. Anchor on the same `sub.id`
  / `group.nodeId` the active-state logic already uses around lines 288-298.
- **Header.** A compact "N here" next to `TeamChip` and `SyncChip`. Keep it
  clearly distinct from `TeamChip`'s count, which is a 10-second Postgres poll of
  who *belongs*, not who is *present*. Two adjacent numbers that look alike and
  mean different things is its own confusion, so "4 people" and "2 here" need
  wording that separates them.
- Never count yourself.

Names come from `personLabel()` in `src/lib/team/people.ts`, which already turns
a member email into a readable name and falls back to the address when the local
part is not a name. Reuse it rather than writing a second one.

## Files

| File | Change |
|---|---|
| `src/lib/presence/channel.ts` | new. Channel lifecycle, track/untrack. |
| `src/lib/presence/derive.ts` | new. Pure reduction of raw presence state. |
| `src/components/PresenceProvider.tsx` | new. One subscription, context. |
| `src/components/Layout.tsx` | mount the provider around the shell. |
| `src/components/NavShell.tsx` | per-node dot on subsection and group rows. |
| `src/components/PresenceChip.tsx` | new. The header "N here". |
| `src/lib/i18n/strings.ts` | `presence.here`, `presence.who`. Both locales. |
| `supabase/migrations/<ts>_presence_authorization.sql` | new. RLS. |
| `src/lib/sync/engine.ts` | tear down the channel on `SIGNED_OUT`. |

Every UI string needs `en` and `id`. All 269 current keys carry both, and
`npm run i18n:report` checks it.

### Five departures from the table above, and why

1. **`src/lib/presence/route.ts` is new.** The provider mounts in `Layout`, which
   is the *parent* route, so `useParams()` there returns `{}` and every dot would
   land nowhere. The node id is parsed from the pathname instead, and that parse
   is pure, so it is tested rather than hand-checked.
2. **`/choose`, `/macro` and `/style` map back to their subsection ids.** The
   sidebar links those three tabs as `/worksheet/<id>` and `WorksheetView`
   redirects. Without the reverse map, a person sitting on a tab the nav itself
   offers shows no dot on it, which reads as a broken feature rather than as the
   deferred "presence on the compare pages". Derived by inverting the existing
   `SUB_PAGE_ROUTES`, so a fourth dedicated page cannot drift out of sync.
3. **`useMemberLabels` added to `src/lib/team/people.ts`.** The number of dots is
   decided by who is in the room, so `useMemberLabel` per person would be a hook
   in a loop. This is the same cache behind a plain lookup, which is what "reuse
   `personLabel` rather than writing a second one" asked for.
4. **A third string, `presence.someone`.** The member list comes from the server,
   so offline (the normal condition in the room) there is a dot and no name for
   it. An account uuid is not a name.
5. **`scripts/enable-presence.sh` and `scripts/verify-presence.mjs` are new.** The
   spec called for both sides of the boundary in one sitting; automating it is
   strictly better than remembering to do it, and it now runs on every apply.

## Tests

This repo has no component-testing setup (`vitest.config.ts` is
`environment: 'node'`, `include: tests/**/*.test.ts`) and this spec must not
introduce one. So put the logic somewhere testable and test that:

`src/lib/presence/derive.ts` reduces raw presence state to
`Map<nodeId, Person[]>`. New `tests/presence-derive.test.ts` covers:

- Self is excluded, keyed on the account id.
- Two devices belonging to one account count as one person, not two.
- A person with no `nodeId` yet appears in the project count but on no tab.
- Stale entries are dropped.
- An empty or malformed presence payload yields an empty map rather than
  throwing. Presence state is remote input.

The channel wiring itself is verified by hand, below.

## Verification

1. ✅ `npm run lint` (0 errors; 12 pre-existing fast-refresh warnings, one per
   provider in this codebase), `npx tsc --noEmit` clean, `npx vitest run`
   355/355, `npm run build` green.
2. ✅ **Two profiles, same team, different sections.** Run by
   `scripts/check-presence-live.mjs`, two Chrome profiles on the built bundle,
   two real accounts joined through the Teams page. Each sees one dot, on the
   other's section, titled with the other's name (`Here now: Budi Santoso`);
   both headers read exactly `1 here now`; neither sees a dot on their own
   section; a realtime socket is asserted to exist rather than assumed.
   ✅ **And the dot follows, twelve times running**, in ~615ms each. Twelve
   deliberately, not five: on the presence-only transport the first four landed
   and the fifth never did, so a five-step walk is exactly the length that cannot
   tell a working build from the broken one. A newcomer also learns where
   everybody already is, unprompted, in ~1.4s.
3. ✅ Closing the tab removes the dot — `verify-presence.mjs` check 6, asserted on
   the other member's observed state, not on an absence of errors.
4. ✅ **Both sides of the boundary, in one run.** `verify-presence.mjs` 14/14: a
   member subscribes and is seen (1a/1b); a non-member is refused on the same
   topic *while the member is still subscribed* (2a–2d, which is what separates
   denial from an outage); the anon key alone is refused (3); a malformed topic is
   refused by denial rather than a raised cast error (4a/4b); and after joining,
   the former non-member gets in (5b).
5. ✅ `?sync=poll` → no presence, sync still works. Asserted as a pair, because
   "no dots" is also what a feature that failed to boot looks like: **no new
   realtime socket is opened** (counted over CDP, against a run in the same
   script where one was), no header chip, no sidebar dots, and a teammate's write
   still lands in this browser's IndexedDB in ~3s.
6. ✅ Signed out, and Supabase unconfigured: no errors, no channel. Two fresh
   profiles. Signed out: no realtime socket, no chip, zero error-level console or
   network entries. Unconfigured: a second bundle built with `VITE_SUPABASE_*`
   blank (`scripts/preview-build.sh --with-unconfigured`) makes **no request to
   any `supabase.co` host at all**, opens no websocket, and logs nothing. That is
   behavioural; an earlier version read the page for a sign-in control and passed
   on the word "account" appearing in onboarding copy.
8. ✅ **The header at 390px with somebody present.** Measured, not eyeballed,
   and screenshotted. The phone context strip holds team chip (146px), passage ×
   genre (107px) and `1 here now` (89px) inside 390 with **0px of row overflow**,
   and `elementFromPoint` confirms the chip is the topmost thing at its own
   centre — the first-run coach marks lay a scrim over the header, so that check
   dismisses the tour first or it measures the tour.
   ⚠️ One unrelated find: the page scrolls sideways by **15px** at 390px, and the
   overflowing element is the **account-menu avatar in the top header row**
   (`right: 405` against a 390 viewport), not anything presence added — the
   presence chip is `hidden sm:flex` and is not in that row at all. Pre-existing,
   worth its own fix.
7. ✅ **Free-plan Realtime limits, 2026-08-25:** 200 concurrent peak connections
   and **2 million messages per month**. Connections are irrelevant at workshop
   scale. Messages were not: announcements fan out to every member, so the cost is
   quadratic in room size, and the 25-second heartbeat this was first written with
   came to ~1.15M for a ten-day Bali-sized workshop — over half the month, spent on
   a decoration. The heartbeat is 60s and the TTL 180s, which brings the same
   workshop to ~480k. The arithmetic is in `derive.ts` beside the constants.

All of the above is `scripts/check-presence-live.mjs`, against the built bundle:

```
scripts/preview-build.sh --with-unconfigured        # terminal 1
UNCONFIGURED_URL=http://localhost:4174/genre-research-app/ \
  node scripts/check-presence-live.mjs http://localhost:4173/genre-research-app/
```

It needs `SUPABASE_ACCESS_TOKEN`, creates two throwaway accounts and deletes them
on the way out, including on failure. The harness in `scripts/lib/browser.mjs`
gained what these assertions needed and the older checks did not have: CDP event
subscription, plus `watchSockets()`, `watchRequests()` and `watchErrors()`, so
"no channel was opened" and "nothing errored" are read off the wire instead of
inferred from a quiet screen.

## Review record (2026-08-26)

Independent review of `7889346..HEAD` at high effort. The migration was checked
and held: `private: true` is set, the topic predicate fails closed on NULL and on
a non-uuid topic without raising, `substring(from 10)` lands on the uuid, and
`select` + `insert` is the right pair. Six findings, four fixed, one is the
blocker above, one is somebody else's bug.

| # | Finding | Outcome |
|---|---|---|
| 1 | `channel.ts` treats a server `CLOSED` as fail-open and never rejoins; `joinedKey` stays set so the identity guard blocks a rejoin, and the heartbeat keeps calling `track()` on a dead channel | **Open — this is the blocker.** The fix is a design choice (throttle / broadcast / rejoin), so it is not made here |
| 2 | `PresenceProvider` left `raw` stale on a project switch: cleanup unsubscribes before `leavePresence()` publishes the empty room, and the no-project branch never subscribes, so the old team's dots rendered over the new project for up to a TTL | Fixed: `setRaw({})` at the top of the effect |
| 3 | The member-email cache is only invalidated on sign-out, so a teammate who joins mid-session is "Someone" until a reload — the ordinary case for presence, not an edge one | Fixed: `refreshMembers()`, asked for once when an unknown id appears, rate-limited to one call a minute, with a watcher so the hook re-renders |
| 4 | `derive.ts` clamped the AGE rather than the timestamp, so a fast clock both outlived a correct one and outranked the same account's believable device — putting the dot on the tab they had left. The comment and the test both claimed otherwise | Fixed: future stamps are ranked below believable ones and clamped for TTL. The comment now states the residual honestly instead of overclaiming, and the test asserts the expiry it only named before |
| 5 | `nodeIdFromPath` knew `SUB_PAGE_ROUTES` but not the journey's GROUP routes, so the group ids `NavShell` passes to `PresenceDots` (`s2`, `s3` → `/describe/big-picture`, `/describe/style`) could never match: someone on a group landing was counted in the header and shown nowhere | Fixed: the reverse map is built from both sources. Stage landings stay null on purpose |
| 6 | `check-presence-live.mjs` defaulted to port 4183 while `preview-build.sh` serves 4173/4174 | Fixed |

Finding 5 is the same mistake as departure 2 in this spec, one level up the tree:
a route the nav offers that presence cannot name. Worth remembering as a shape.

## Deferred

- Presence for anything other than the worksheet nav (the Genres page, the
  compare pages, the report).
- A cursor or field-level "Priya is typing in this box". Much more traffic, and
  the per-section dot is what answers the question people actually have.
- Using the realtime connection to nudge the sync poll, which is the other half
  of the `?sync=live` seam `mode.ts` describes and this spec does not build.
- Surfacing `sync_records.updated_by` (server-stamped `auth.uid()`, already in
  the table, not selected by `pull.ts`) as a cross-check on client-side
  authorship. Unrelated to presence, but it is the natural next thing.

## Risks

- **Privacy inside the team.** Presence broadcasts which question you are
  looking at to everyone on the team. That is the feature, and a team is a group
  who joined one worksheet together, but it is worth being deliberate about
  rather than discovering later. `?sync=poll` is the opt-out.
- **A silent authorization failure looks like success.** See the verify-first
  list. Assert on observed state from both sides, never on the absence of an
  exception.
- **Two numbers in one header.** If "4 people" and "2 here" sit next to each
  other without wording that separates membership from presence, this feature
  makes the header harder to read rather than easier.
