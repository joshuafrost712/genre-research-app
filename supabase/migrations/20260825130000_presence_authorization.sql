-- Realtime Authorization for live team presence (spec 12).
--
-- Presence rides on Supabase Realtime, on a PRIVATE channel per project named
-- `presence:<project_id>`. Private is what makes RLS on realtime.messages apply
-- at all, and this file is that RLS.
--
-- Apply with scripts/enable-presence.sh (idempotent; safe to re-run, and safe to
-- run while people are working: it adds policies to a table that currently has
-- none, so it can only ever widen access from "nobody" to "team members").
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION OWNS realtime.messages FOR THIS PROJECT
-- ---------------------------------------------------------------------------
--
-- Nothing else here touches that table, and the next spec that wants a private
-- channel must read these two policies before adding a third. They are written
-- to fail closed on any topic that is not `presence:<uuid>`, so a future private
-- topic gets NO access until somebody deliberately grants it. That is the
-- intended default. Widening it by loosening the predicate below would silently
-- open presence too.
--
-- ---------------------------------------------------------------------------
-- Facts checked against THIS project on 2026-08-25, not assumed
-- ---------------------------------------------------------------------------
--
--  * `realtime.topic()` exists and is `nullif(current_setting('realtime.topic',
--    true), '')::text` — so it returns NULL, not an error, when Realtime has not
--    set the topic. The guard below therefore has to handle NULL first.
--  * `realtime.messages` already has RLS enabled (relrowsecurity = true) with
--    ZERO policies, i.e. deny-all. Confirmed from the client side: an
--    unauthenticated private-channel join returns "Unauthorized: You do not have
--    permissions to read from this Channel topic". So the baseline is denial and
--    these policies are the only thing that opens it.
--  * `authenticated` already holds USAGE on schema realtime and SELECT + INSERT
--    on realtime.messages. RLS is the whole boundary; the grants are not.
--  * `select` + `insert` is the correct pair. Realtime checks read authorization
--    with a SELECT and write authorization (which tracking your own presence
--    needs) with an INSERT.
--  * `alter table ... enable row level security` is deliberately NOT run here.
--    realtime.messages is owned by supabase_realtime_admin, not postgres, so the
--    ALTER would fail; CREATE POLICY on it does not. The guard below asserts the
--    state instead of trying to set it.
--
-- The `extension = 'presence'` predicate is deliberately LEFT OUT. The real
-- boundary is the topic plus membership, and a narrower predicate that is subtly
-- wrong costs a debugging session for no security gain — a wrong guess here does
-- not raise, it just makes the room look empty.

-- ---------------------------------------------------------------------------
-- Guard: fail loudly rather than creating an inert policy
-- ---------------------------------------------------------------------------

-- Realtime's own schema is created LAZILY, by the Realtime service's migrations,
-- the first time a client opens a channel on the project. On 2026-08-25 this
-- project's `realtime` schema was empty until a probe connected, and the Supabase
-- health endpoint reported realtime UNHEALTHY while it was. So a fresh project
-- can reach this migration with no realtime.messages to protect, and creating
-- these policies later than the app ships is the dangerous order. Say so.
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception
      'realtime.messages does not exist yet. The Realtime service creates its '
      'schema on the first channel connection: open the app once (or run the '
      'probe in scripts/enable-presence.sh) and re-run this migration.';
  end if;
  if to_regproc('realtime.topic') is null then
    raise exception 'realtime.topic() is missing; the realtime schema is only partly migrated.';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass) then
    raise exception
      'row level security is OFF on realtime.messages. Adding policies to an '
      'unprotected table would read as a lockdown and be none.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The predicate
-- ---------------------------------------------------------------------------

-- "Is the caller a member of the project this topic belongs to?"
--
-- A topic that is not exactly `presence:<uuid>` returns false. It must never
-- raise: an invalid_text_representation from a bare `::uuid` cast would surface
-- as a channel error on a topic that should simply be refused, and a raise inside
-- a policy is a worse failure than a denial. The regex is the whole guard; the
-- cast after it cannot fail.
create or replace function public.presence_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_topic is null then
    return false;
  end if;
  if p_topic !~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  -- is_member is security definer and reads auth.uid(), so this is the same
  -- membership test sync_records_select and push_records use. One predicate.
  return public.is_member(substring(p_topic from 10)::uuid);
end;
$$;

-- Same shape as every other function grant in 20260806000000_team_sync.sql, and
-- for the same reason: Postgres grants EXECUTE to public by default, and
-- `revoke ... from public` does not reach anon, which holds its own grant.
revoke execute on function public.presence_topic_member(text) from public, anon;
grant  execute on function public.presence_topic_member(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The policies
-- ---------------------------------------------------------------------------

-- Read: see who else is in your team's presence channel.
drop policy if exists presence_read_own_teams on realtime.messages;
create policy presence_read_own_teams on realtime.messages
  for select to authenticated
  using (public.presence_topic_member(realtime.topic()));

-- Write: announce yourself in your team's presence channel. Realtime tests this
-- with an INSERT, so without it `track()` fails and everybody is invisible while
-- still being able to see others — a half-working room that looks like a bug in
-- somebody else's browser.
drop policy if exists presence_write_own_teams on realtime.messages;
create policy presence_write_own_teams on realtime.messages
  for insert to authenticated
  with check (public.presence_topic_member(realtime.topic()));
