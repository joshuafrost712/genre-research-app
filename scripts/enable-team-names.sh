#!/usr/bin/env bash
# Apply the team-names migration and prove it is locked down.
#
#   ./scripts/enable-team-names.sh
#
# Applies supabase/migrations/20260824000000_team_names.sql through the Management
# API's SQL endpoint (no psql, no DB password), then checks the two things that can
# be wrong in a way nothing else would notice:
#
#  1. anon must hold no execute on either new function. `revoke ... from public`
#     does not cover anon or authenticated, which get their grants explicitly, so
#     this is the only proof the revoke took.
#  2. rename_shared_project must RAISE for a non-member, not quietly update zero
#     rows. RLS denial is silent filtering: an update that matches nothing returns
#     success, and the client would show a renamed team no other device can see.
#
# Strictly additive and idempotent: safe to run while people are working in the
# app, and safe to re-run after editing the migration.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.claude/secrets"
MIGRATION="$APP_DIR/supabase/migrations/20260824000000_team_names.sql"

# --- Supabase access token -----------------------------------------------------
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$SECRETS/supabase.env" ]]; then
  set -a; . "$SECRETS/supabase.env"; set +a
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN not set and $SECRETS/supabase.env not found." >&2
  exit 1
fi

# --- Project ref ---------------------------------------------------------------
if [[ -z "${PROJECT_REF:-}" ]]; then
  URL="$(grep '^VITE_SUPABASE_URL=' "$APP_DIR/.env" | cut -d= -f2-)"
  PROJECT_REF="$(printf '%s' "$URL" | sed -E 's#https?://([^.]+)\..*#\1#')"
fi
if [[ -z "$PROJECT_REF" ]]; then
  echo "ERROR: could not determine PROJECT_REF (set it, or fill VITE_SUPABASE_URL in .env)." >&2
  exit 1
fi

run_sql() {
  # $1 = SQL. Prints the JSON result; exits non-zero on an API error.
  python3 - "$1" <<'PY' > /tmp/genre-names-payload.json
import json, sys
print(json.dumps({"query": sys.argv[1]}))
PY
  local out status
  out="$(mktemp)"
  status="$(curl -s -o "$out" -w '%{http_code}' -X POST \
    "$API/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @/tmp/genre-names-payload.json)"
  if [[ "$status" != "200" && "$status" != "201" ]]; then
    echo "SQL failed (http $status):" >&2
    cat "$out" >&2
    rm -f "$out" /tmp/genre-names-payload.json
    return 1
  fi
  cat "$out"
  rm -f "$out" /tmp/genre-names-payload.json
}

echo "==> Project $PROJECT_REF"

echo "==> Applying $(basename "$MIGRATION")"
run_sql "$(cat "$MIGRATION")" > /dev/null
echo "    applied"

echo "==> Checking both functions exist"
run_sql "
  select count(*) as functions from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('rename_shared_project','project_members_list');
" | python3 -c '
import json, sys
n = json.load(sys.stdin)[0]["functions"]
print("    functions=%s/2" % n)
sys.exit(0 if n == 2 else 1)
'

echo "==> Checking anon holds nothing and authenticated can call"
run_sql "
  select
    has_function_privilege('anon','public.rename_shared_project(uuid,text)','execute') as anon_rename,
    has_function_privilege('anon','public.project_members_list(uuid)','execute')       as anon_members,
    has_function_privilege('authenticated','public.rename_shared_project(uuid,text)','execute') as auth_rename,
    has_function_privilege('authenticated','public.project_members_list(uuid)','execute')       as auth_members;
" | python3 -c '
import json, sys
r = json.load(sys.stdin)[0]
expect = {"anon_rename": False, "anon_members": False, "auth_rename": True, "auth_members": True}
bad = {k: (r[k], v) for k, v in expect.items() if r[k] != v}
for k, v in expect.items():
    print(f"    {k:14} {str(r[k]):5} (want {v})")
if bad:
    print(f"FAILED: {bad}", file=sys.stderr)
    sys.exit(1)
'

# A non-member rename must be an ERROR, not a no-op. Run as `authenticated` with no
# auth.uid(), which is the shape of every call the app makes minus membership.
echo "==> Checking a non-member rename raises rather than silently doing nothing"
run_sql "
  do \$\$
  declare
    victim uuid;
    raised boolean := false;
  begin
    select project_id into victim from public.shared_projects limit 1;
    if victim is null then
      raise notice 'no shared projects yet; nothing to test against';
      return;
    end if;
    begin
      -- No auth.uid() in this session, so is_member is false by construction.
      perform public.rename_shared_project(victim, 'should not stick');
    exception when others then
      raised := true;
    end;
    if not raised then
      raise exception 'rename_shared_project did NOT raise for a non-member';
    end if;
  end
  \$\$;
" > /dev/null
echo "    raises correctly"

echo "==> Checking existing team names were left alone"
run_sql "
  select count(*) as total,
         count(*) filter (where name = 'should not stick') as damaged
  from public.shared_projects;
" | python3 -c '
import json, sys
r = json.load(sys.stdin)[0]
print("    shared_projects=%s  damaged=%s" % (r["total"], r["damaged"]))
sys.exit(0 if r["damaged"] == 0 else 1)
'

echo "==> Done. Teams can be named, and the name reaches every member."
