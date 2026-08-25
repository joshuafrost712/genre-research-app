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

**Status:** specced, not built. One session, no branch yet. Nothing here is
started, so there is no claim to respect.

## What done looks like

Two people in the same team, on different sections of the worksheet:

- Each sees a small dot with the other's name on the section the other is
  working in, in the sidebar (`NavShell`).
- The header shows how many other people are in the project right now.
- Navigating moves your dot within about a second.
- Closing the tab removes it.
- Somebody who is not on the team sees nothing and cannot join the channel.

## Verify these three things BEFORE writing any SQL

The authorization design below is built on three claims that could not be
checked from the repo when this was specced. Confirm each against the live
Supabase project first. A wrong guess here fails **silently**: RLS denial is
filtering, not an error, so a bad policy looks exactly like "nobody is here" to
a member and exactly like "correctly denied" to a non-member.

1. That `realtime.topic()` exists in this project's `realtime` schema.
2. That `extension = 'presence'` is the right predicate for presence messages.
   Consider leaving it out of the first cut. `realtime.topic()` plus
   `is_member()` is the actual boundary, and a narrower predicate that is wrong
   costs a debugging session for no security gain.
3. That `select` plus `insert` is the correct policy pair for presence.

Also establish and record how the migration reaches the hosted project. There is
no `supabase/config.toml` in this repo. The Supabase PAT runs DDL as `postgres`
(see the vault note on management access), which is the likely route.

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

1. `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`.
2. Two profiles, same team, different sections. Each sees a dot with the other's
   name on the other's section, and the header shows "1 here". Navigate, and the
   dot follows within about a second.
3. Close one tab. Its dot disappears from the other browser.
4. **Both sides of the boundary, in the same sitting.** A third account that is
   not on the team, joining the same topic by hand: zero presence events. Then
   confirm a real member still sees events. Proving only the first half cannot
   distinguish "correctly denied" from "the channel is broken for everyone".
5. Load with `?sync=poll`: no presence anywhere, and ordinary sync still works.
6. Signed out, and with Supabase unconfigured: no errors, no channel.
7. Check the current Realtime free-tier limits on Supabase's pricing page and
   record the numbers and the date in the commit. A workshop is under ten
   people, so this is very unlikely to bite, but it should be a checked fact.

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
