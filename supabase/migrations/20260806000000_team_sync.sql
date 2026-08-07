-- Cloud sync for the Local Genres Research app.
--
-- Until now Supabase was the identity layer only: answers lived in per-browser
-- IndexedDB and signing in on a second device showed you nothing. This adds the
-- data plane. One project is one syncable unit; a personal project has one member,
-- a team project has several. That is the only difference between the two, which
-- is why "my work follows me across devices" and "seven people share a worksheet"
-- are the same machinery.
--
-- Apply with scripts/enable-team-sync.sh (idempotent; safe to re-run).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A local project that has been published to the cloud. `project_id` is the
-- client-generated uuid already sitting in the browser's Dexie `projects` table,
-- so publishing never re-keys anything.
create table if not exists public.shared_projects (
  project_id uuid primary key,
  name       text not null default '',
  join_code  text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.shared_projects(project_id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx
  on public.project_members (user_id);

-- The replicated record store. One row per (project, table, record), mirroring
-- the client's `ShardRecord` shape so lib/sync/merge.ts applies these unchanged.
create table if not exists public.sync_records (
  project_id uuid not null references public.shared_projects(project_id) on delete cascade,
  tbl        text not null,
  record_id  text not null,
  op         text not null check (op in ('upsert', 'delete')),

  -- TEXT, DELIBERATELY, AND DO NOT "FIX" THIS TO timestamptz.
  -- merge.ts compares timestamps with a plain string `>`. The client writes
  -- new Date().toISOString(), i.e. `2026-08-06T04:00:00.000Z`. A timestamptz
  -- column round-trips through PostgREST as `2026-08-06T04:00:00+00:00`, and
  -- those two forms do not compare the same way byte-for-byte ('+' is 0x2B,
  -- '.' is 0x2E, 'Z' is 0x5A). Keeping the client's exact bytes is what keeps
  -- last-write-wins agreeing between client and server.
  updated_at text not null,

  author_id  text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  data       jsonb,

  -- The pull cursor, and NEVER the conflict key. Workshop device clocks are
  -- wrong by minutes; if clients paged on `updated_at` a tablet running fast
  -- would make every other device's rows permanently invisible. clock_timestamp()
  -- (not now(), which is transaction-start) advances within a batch so a large
  -- push cannot land several rows on one instant and hide some behind a cursor.
  server_at  timestamptz not null default clock_timestamp(),

  primary key (project_id, tbl, record_id)
);

create index if not exists sync_records_cursor_idx
  on public.sync_records (project_id, server_at);

-- Deletes are TOMBSTONES (op = 'delete'), never real DELETEs. Two reasons: a
-- real delete cannot beat a concurrent edit under last-write-wins, and it would
-- force `replica identity full` for Realtime to carry the old row.

-- ---------------------------------------------------------------------------
-- Membership predicate
-- ---------------------------------------------------------------------------

-- security definer is load-bearing. A policy on project_members that queries
-- project_members inline is infinite recursion (Postgres 42P17), the classic
-- Supabase membership footgun. Routing every membership test through a definer
-- function sidesteps the policy entirely.
create or replace function public.is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.shared_projects enable row level security;
alter table public.project_members enable row level security;
alter table public.sync_records    enable row level security;

-- Revoke by ROLE NAME. Postgres default privileges grant anon and authenticated
-- explicitly, so `revoke ... from public` leaves both still holding their grants.
revoke all on public.shared_projects from anon, authenticated;
revoke all on public.project_members from anon, authenticated;
revoke all on public.sync_records    from anon, authenticated;

-- Reads of sync_records go direct (Realtime needs a SELECT policy to filter on).
-- Writes do not: push_records is the only write path, so INSERT/UPDATE/DELETE
-- stay revoked above and no write policy exists to be reasoned about.
grant select on public.sync_records to authenticated;

drop policy if exists sync_records_select on public.sync_records;
create policy sync_records_select on public.sync_records
  for select to authenticated
  using (public.is_member(project_id));

-- shared_projects and project_members carry RLS with ZERO policies, i.e. deny
-- all direct access. Everything reaches them through the definer functions below.
-- Fewer policies means sync_records is the only access rule to get right.

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

-- The ONLY way rows enter sync_records.
--
-- Two things here are the difference between working and silently-wrong sync:
--
--  1. The membership check RAISES. Under plain RLS a non-member's insert would
--     be filtered to zero rows with no error, and the client would cheerfully
--     clear its outbox having replicated nothing. A raise is loud.
--
--  2. The `where` on DO UPDATE is server-side last-write-wins. Without it, the
--     last device to reach the network wins regardless of when it made the edit,
--     so a tablet that was offline for ninety seconds stomps everyone on
--     reconnect. The comparison mirrors merge.ts exactly (updated_at, then
--     author_id as the tiebreak) so client and server always pick the same winner.
create or replace function public.push_records(p_project uuid, p_records jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_member(p_project) then
    raise exception 'not a member of project %', p_project using errcode = '42501';
  end if;

  with incoming as (
    select
      r->>'tbl'                      as tbl,
      r->>'record_id'                as record_id,
      r->>'op'                       as op,
      r->>'updated_at'               as updated_at,
      coalesce(r->>'author_id', '')  as author_id,
      r->'data'                      as data
    from jsonb_array_elements(p_records) r
  ),
  -- A 400ms typing debounce inside one flush window produces several outbox rows
  -- for the same cell. ON CONFLICT raises "cannot affect row a second time" if a
  -- single statement hits one conflict target twice, so collapse to the newest
  -- per key first. The client dedupes too; this is the backstop.
  deduped as (
    select distinct on (tbl, record_id) *
    from incoming
    order by tbl, record_id, updated_at desc, author_id desc
  ),
  applied as (
    insert into public.sync_records
      (project_id, tbl, record_id, op, updated_at, author_id, updated_by, data, server_at)
    select p_project, tbl, record_id, op, updated_at, author_id, auth.uid(), data, clock_timestamp()
    from deduped
    on conflict (project_id, tbl, record_id) do update set
      op         = excluded.op,
      updated_at = excluded.updated_at,
      author_id  = excluded.author_id,
      updated_by = excluded.updated_by,
      data       = excluded.data,
      server_at  = clock_timestamp()
    where (public.sync_records.updated_at, public.sync_records.author_id)
        < (excluded.updated_at,            excluded.author_id)
    returning 1
  )
  select count(*) into n from applied;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publish / join / list
-- ---------------------------------------------------------------------------

-- Readable join code, same shape and word list as scripts/enable-signup.sh, for
-- the same reason: a code people read off a whiteboard and type on a phone.
create or replace function public.gen_join_code()
returns text
language sql
volatile
set search_path = ''
as $$
  with words as (
    select unnest(string_to_array(
      'river lantern maple cedar harbor meadow ember willow pebble cobalt ' ||
      'thicket amber quartz beacon cypress juniper marigold saffron indigo breeze ' ||
      'cavern dune fjord glade summit tide valley wren zephyr lattice compass ' ||
      'anchor bramble copper garden hollow island kettle ladder mantle needle ' ||
      'orchard pillar quiver ribbon saddle timber velvet walnut almond basket ' ||
      'candle daisy eagle feather granite hammer ivory jasmine kernel lemon ' ||
      'marble nutmeg olive parcel quarry rabbit silver tulip umber violet ' ||
      'yarrow acorn birch clover dolphin elder fennel ginger heather jasper ' ||
      'kelp linen mallow nectar oyster peach quince raven sorrel thistle ' ||
      'umbra vessel wheat yonder zinnia bluff creek dawn ferry grove haven inlet',
      ' ')) as w
  )
  select string_agg(w, '-' order by rn) || '-' || lpad((floor(random() * 900) + 100)::int::text, 3, '0')
  from (select w, row_number() over (order by random()) rn from words limit 3) picked;
$$;

-- Publish a local project. Idempotent: re-publishing returns the existing code
-- rather than rotating it, so a facilitator who taps twice does not invalidate
-- the code already written on the whiteboard.
create or replace function public.create_shared_project(p_project uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing text;
  code     text;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select sp.join_code into existing
  from public.shared_projects sp where sp.project_id = p_project;

  if existing is not null then
    -- Already published. Make sure the caller is a member, then hand back the code.
    if not public.is_member(p_project) then
      raise exception 'project % is already published by someone else', p_project
        using errcode = '42501';
    end if;
    return existing;
  end if;

  for i in 1..10 loop
    begin
      code := public.gen_join_code();
      insert into public.shared_projects (project_id, name, join_code, created_by)
      values (p_project, coalesce(p_name, ''), code, auth.uid());
      exit;
    exception when unique_violation then
      code := null;   -- code collided; draw again
    end;
  end loop;

  if code is null then
    raise exception 'could not allocate a unique join code';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project, auth.uid(), 'owner')
  on conflict do nothing;

  return code;
end;
$$;

-- Join by code.
--
-- Returns the project's CONTAINER POINTERS, not just its id, and that is the
-- whole point. Entries are addressed by focus_text_id / genre_id / worksheet_id,
-- and those pointers live in the client's local `meta` table, which is not
-- replicated. A join that returned only project_id would leave every device
-- pointed at its own auto-created "Untitled genre": rows replicate, the status
-- chip goes green, and nobody sees anybody. The client uses these to adopt the
-- shared project's containers instead of creating its own.
create or replace function public.join_project(p_code text)
returns table (project_id uuid, name text, focus_text_id text, genre_id text, worksheet_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  sp public.shared_projects%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  select * into sp from public.shared_projects s
  where lower(s.join_code) = lower(btrim(p_code));

  if not found then
    raise exception 'no team with that code' using errcode = 'P0002';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (sp.project_id, auth.uid(), 'member')
  on conflict do nothing;

  return query
  select
    sp.project_id,
    sp.name,
    -- Oldest container of each kind wins, so every joiner adopts the same one
    -- even if a stray duplicate exists.
    (select r.record_id from public.sync_records r
      where r.project_id = sp.project_id and r.tbl = 'focusTexts' and r.op = 'upsert'
      order by r.data->>'created_at' nulls last, r.record_id limit 1),
    (select r.record_id from public.sync_records r
      where r.project_id = sp.project_id and r.tbl = 'genres' and r.op = 'upsert'
      order by r.data->>'created_at' nulls last, r.record_id limit 1),
    (select r.record_id from public.sync_records r
      where r.project_id = sp.project_id and r.tbl = 'worksheets' and r.op = 'upsert'
      order by r.data->>'created_at' nulls last, r.record_id limit 1);
end;
$$;

create or replace function public.my_projects()
returns table (project_id uuid, name text, join_code text, role text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select sp.project_id, sp.name, sp.join_code, m.role,
         (select count(*) from public.project_members c where c.project_id = sp.project_id)
  from public.shared_projects sp
  join public.project_members m
    on m.project_id = sp.project_id and m.user_id = auth.uid()
  order by sp.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Function grants, by role name
-- ---------------------------------------------------------------------------

revoke execute on function public.is_member(uuid)                    from public, anon;
revoke execute on function public.push_records(uuid, jsonb)          from public, anon;
revoke execute on function public.create_shared_project(uuid, text)  from public, anon;
revoke execute on function public.join_project(text)                 from public, anon;
revoke execute on function public.my_projects()                      from public, anon;
revoke execute on function public.gen_join_code()                    from public, anon;

grant execute on function public.is_member(uuid)                     to authenticated;
grant execute on function public.push_records(uuid, jsonb)           to authenticated;
grant execute on function public.create_shared_project(uuid, text)   to authenticated;
grant execute on function public.join_project(text)                  to authenticated;
grant execute on function public.my_projects()                       to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- Realtime is a doorbell: an event only nudges the client to run its normal
-- incremental pull, so payload shape and event ordering never matter. Because
-- deletes are tombstones this publication only ever carries INSERT and UPDATE,
-- which is why `replica identity full` is not needed.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sync_records'
  ) then
    alter publication supabase_realtime add table public.sync_records;
  end if;
end
$$;
