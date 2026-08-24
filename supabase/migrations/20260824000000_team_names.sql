-- Teams you can tell apart: a name anyone on the team can set, and the list of
-- who is actually on it.
--
-- Both fix the same workshop failure. Every shared worksheet showed as "Untitled
-- project", because nothing in the app ever set a project's name and
-- `create_shared_project` snapshots `shared_projects.name` on first insert and
-- then early-returns forever after. Auto-publish fires seconds after someone
-- types a passage, so the name froze before anybody had a chance to choose one.
-- A client-side rename alone could not fix it: the team list reads
-- `shared_projects.name`, not the replicated `projects` row.
--
-- STRICTLY ADDITIVE, on purpose. People are working in the live app while this
-- applies. `my_projects()` is deliberately left alone: adding a column to a
-- `returns table` function needs `drop function` first, and a dropped function is
-- a window in which every signed-in client's project list fails. A separate
-- `project_members_list()` costs one extra round trip and no window at all.

-- ---------------------------------------------------------------------------
-- Rename
-- ---------------------------------------------------------------------------

-- Any MEMBER may rename, not only the owner. In a workshop the person who
-- happened to tap Share first is not reliably the person who knows what the team
-- is called, and a team of four watching each other's screens is not a setting
-- where rename needs to be a privilege. Renaming is also inherently recoverable:
-- the next person just types it again.
--
-- The membership check RAISES rather than filtering, for the reason given at
-- length on push_records: an `update` that matches zero rows returns success, and
-- the client would show a renamed team that no other device can see.
create or replace function public.rename_shared_project(p_project uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  if not public.is_member(p_project) then
    raise exception 'you are not on that team' using errcode = '42501';
  end if;

  -- Trim, collapse internal whitespace, cap the length. The cap is a display
  -- concern: this string goes in a header chip on a phone, and the app truncates
  -- rather than wraps, so a 400-character "name" would render as an ellipsis and
  -- read as a bug. 80 is generous for "Walak team" or "Tim Psalms 3".
  clean := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);

  if clean = '' then
    raise exception 'a team needs a name' using errcode = '22023';
  end if;

  update public.shared_projects sp
  set name = clean
  where sp.project_id = p_project;

  return clean;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who is on the team
-- ---------------------------------------------------------------------------

-- "4 members" cannot answer the only question a facilitator actually asks, which
-- is whether the four are the right four. Emails are what people signed in with
-- and already know about each other in a workshop room, so they are the cheapest
-- identifier that is genuinely recognisable.
--
-- Visible to fellow members only, and `auth.users` is read from inside the
-- definer rather than exposed: a member of team A learns nothing about team B.
create or replace function public.project_members_list(p_project uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  if not public.is_member(p_project) then
    raise exception 'you are not on that team' using errcode = '42501';
  end if;

  return query
  select m.user_id, u.email::text, m.role, m.joined_at
  from public.project_members m
  join auth.users u on u.id = m.user_id
  where m.project_id = p_project
  -- Owner first, then joining order: the list reads as the story of the team.
  order by (m.role = 'owner') desc, m.joined_at, u.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants, by role name
-- ---------------------------------------------------------------------------

-- `revoke ... from public` alone is not enough: Postgres default privileges grant
-- anon and authenticated explicitly, so both must be named.
revoke execute on function public.rename_shared_project(uuid, text) from public, anon;
revoke execute on function public.project_members_list(uuid)        from public, anon;

grant execute on function public.rename_shared_project(uuid, text)  to authenticated;
grant execute on function public.project_members_list(uuid)         to authenticated;
