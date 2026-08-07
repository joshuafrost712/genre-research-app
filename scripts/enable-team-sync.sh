#!/usr/bin/env bash
# Apply the cloud-sync schema and prove it is locked down.
#
#   ./scripts/enable-team-sync.sh
#
# Applies supabase/migrations/20260806000000_team_sync.sql through the Management
# API's SQL endpoint (no psql, no DB password), then runs scripts/verify-team-sync.mjs,
# which creates two throwaway accounts and checks isolation, last-write-wins, and
# the anon grants against the LIVE project. Idempotent: safe to re-run after editing
# the migration.
#
# Why the verify step is not optional: RLS denial is silent filtering. A wrong
# policy returns zero rows, not an error, so a broken lockdown looks exactly like
# an empty database. Every assertion in the verifier is on present/absent state.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.claude/secrets"
MIGRATION="$APP_DIR/supabase/migrations/20260806000000_team_sync.sql"

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
BASE="https://$PROJECT_REF.supabase.co"

run_sql() {
  # $1 = SQL. Prints the JSON result; exits non-zero on an API error.
  python3 - "$1" <<'PY' > /tmp/genre-sql-payload.json
import json, sys
print(json.dumps({"query": sys.argv[1]}))
PY
  local out status
  out="$(mktemp)"
  status="$(curl -s -o "$out" -w '%{http_code}' -X POST \
    "$API/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @/tmp/genre-sql-payload.json)"
  if [[ "$status" != "200" && "$status" != "201" ]]; then
    echo "SQL failed (http $status):" >&2
    cat "$out" >&2
    rm -f "$out" /tmp/genre-sql-payload.json
    return 1
  fi
  cat "$out"
  rm -f "$out" /tmp/genre-sql-payload.json
}

echo "==> Project $PROJECT_REF"

echo "==> Applying $(basename "$MIGRATION")"
run_sql "$(cat "$MIGRATION")" > /dev/null
echo "    applied"

# --- Structural check -----------------------------------------------------------
echo "==> Checking objects exist and RLS is on"
run_sql "
  select
    (select count(*) from pg_tables
      where schemaname='public'
        and tablename in ('shared_projects','project_members','sync_records')) as tables,
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
        and c.relname in ('shared_projects','project_members','sync_records')
        and c.relrowsecurity) as rls_on,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname in ('is_member','push_records','create_shared_project',
                          'join_project','my_projects')) as functions;
" | python3 -c '
import json, sys
row = json.load(sys.stdin)[0]
t, r, f = row["tables"], row["rls_on"], row["functions"]
print("    tables=%s/3  rls_on=%s/3  functions=%s/5" % (t, r, f))
sys.exit(0 if (t == 3 and r == 3 and f == 5) else 1)
'

# --- Grant check, by role name --------------------------------------------------
# Postgres default privileges hand anon and authenticated their grants explicitly,
# so `revoke ... from public` is not enough and this is how we know it took.
echo "==> Checking anon holds nothing"
run_sql "
  select
    has_table_privilege('anon','public.sync_records','select')                      as anon_select,
    has_table_privilege('anon','public.sync_records','insert')                      as anon_insert,
    has_table_privilege('anon','public.shared_projects','select')                   as anon_projects,
    has_function_privilege('anon','public.push_records(uuid,jsonb)','execute')      as anon_push,
    has_function_privilege('anon','public.join_project(text)','execute')            as anon_join,
    has_function_privilege('anon','public.is_member(uuid)','execute')               as anon_ismember,
    has_table_privilege('authenticated','public.sync_records','select')             as auth_select,
    has_table_privilege('authenticated','public.sync_records','insert')             as auth_insert,
    has_function_privilege('authenticated','public.push_records(uuid,jsonb)','execute') as auth_push;
" | python3 -c '
import json, sys
r = json.load(sys.stdin)[0]
expect = {
    "anon_select": False, "anon_insert": False, "anon_projects": False,
    "anon_push": False, "anon_join": False, "anon_ismember": False,
    "auth_select": True,
    "auth_insert": False,   # push_records is the only write path
    "auth_push": True,
}
bad = {k: (r[k], v) for k, v in expect.items() if r[k] != v}
for k, v in expect.items():
    print(f"    {k:16} {str(r[k]):5} (want {v})")
if bad:
    print(f"FAILED: {bad}", file=sys.stderr)
    sys.exit(1)
'

# --- Behavioural check ----------------------------------------------------------
echo "==> Running verify-team-sync.mjs (creates and deletes throwaway accounts)"
PROJECT_REF="$PROJECT_REF" SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN" \
  node "$APP_DIR/scripts/verify-team-sync.mjs"

cat <<EOF

Cloud sync schema is live on $BASE.

  shared_projects   published projects, one join code each
  project_members   who may read a project
  sync_records      the replicated rows (tombstones, never deletes)

Writes go only through push_records(), which raises 42501 for a non-member and
enforces last-write-wins server-side. anon holds nothing.
EOF
