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

**Status:** built on `feature/spec-12-presence` (2026-08-25). The authorization
migration is applied to the live project and proven from both sides by
`scripts/verify-presence.mjs` (14/14). Lint, `tsc`, 355 tests and the build are
green. What is left is the two-browser walkthrough in a real UI, which is
verification steps 2, 5 and 6 below plus a look at the header at 390px; nobody
can do those from a terminal.

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
  config: { private: true, presence: { key: userId } },
})
```

**`private: true` is load-bearing and is not the default.**
`RealtimeChannel.js:94` defaults it to `false`, and line 440 is where it becomes
the `private=true` join parameter. RLS on `realtime.messages` is consulted only
for private channels, so without this flag the whole authorization migration
below is inert while appearing to be in force, and anyone holding the anon key
and a project uuid can read a team's presence.

- Track `{ userId, label, nodeId }`, where `nodeId` is the worksheet node from
  the route (`useParams()` in `WorksheetView`).
- Re-`track()` on route change, debounced about 500ms, so walking the nav does
  not spray updates.
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
2. ⬜ **Two profiles, same team, different sections.** Needs two real browsers.
   The *data* half of this is automated and passing: `verify-presence.mjs` checks
   5c/5d, that each member sees the other on the node the other is actually on.
   What is left is that the dot renders where it should and the header reads
   right.
3. ✅ Closing the tab removes the dot — `verify-presence.mjs` check 6, asserted on
   the other member's observed state, not on an absence of errors.
4. ✅ **Both sides of the boundary, in one run.** `verify-presence.mjs` 14/14: a
   member subscribes and is seen (1a/1b); a non-member is refused on the same
   topic *while the member is still subscribed* (2a–2d, which is what separates
   denial from an outage); the anon key alone is refused (3); a malformed topic is
   refused by denial rather than a raised cast error (4a/4b); and after joining,
   the former non-member gets in (5b).
5. ⬜ `?sync=poll` → no presence, sync still works. Needs a browser.
6. ⬜ Signed out, and Supabase unconfigured: no errors, no channel. Needs a
   browser. Both paths are early returns in `channel.ts`.
7. ✅ **Free-plan Realtime limits, 2026-08-25:** 200 concurrent peak connections
   and **2 million messages per month**. Connections are irrelevant at workshop
   scale. Messages were not: announcements fan out to every member, so the cost is
   quadratic in room size, and the 25-second heartbeat this was first written with
   came to ~1.15M for a ten-day Bali-sized workshop — over half the month, spent on
   a decoration. The heartbeat is 60s and the TTL 180s, which brings the same
   workshop to ~480k. The arithmetic is in `derive.ts` beside the constants.

Also worth doing while two browsers are open, because an automated check cannot:
look at the header at 390px with somebody else present. The presence chip sits in
the phone context strip beside the team chip and the passage × genre, and that row
has run out of room before.

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
