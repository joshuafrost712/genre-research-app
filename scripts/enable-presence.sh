#!/usr/bin/env bash
# Apply the presence authorization migration and prove BOTH sides of the boundary.
#
#   ./scripts/enable-presence.sh
#
# Applies supabase/migrations/20260825130000_presence_authorization.sql through the
# Management API's SQL endpoint (no psql, no DB password), then runs
# scripts/verify-presence.mjs, which opens real private channels as a member and as
# a non-member and asserts on what each one observes.
#
# Why the verify step is not optional, and why it must run both halves: a private
# channel that nobody can join and a private channel that everybody can join look
# identical from one side. "No presence events" is what correct denial looks like
# to a stranger AND what a broken channel looks like to a teammate. Only checking
# a member and a non-member in the same sitting can tell them apart.
#
# Strictly additive and idempotent: it adds two policies to a table that has none,
# so the only access it can change is from "nobody" to "team members". Safe to run
# while people are working, and safe to re-run after editing the migration.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.claude/secrets"
MIGRATION="$APP_DIR/supabase/migrations/20260825130000_presence_authorization.sql"

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
export PROJECT_REF

run_sql() {
  # $1 = SQL. Prints the JSON result; exits non-zero on an API error.
  python3 - "$1" <<'PY' > /tmp/genre-presence-payload.json
import json, sys
print(json.dumps({"query": sys.argv[1]}))
PY
  local out status
  out="$(mktemp)"
  status="$(curl -s -o "$out" -w '%{http_code}' -X POST \
    "$API/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @/tmp/genre-presence-payload.json)"
  if [[ "$status" != "200" && "$status" != "201" ]]; then
    echo "SQL failed (http $status):" >&2
    cat "$out" >&2
    rm -f "$out" /tmp/genre-presence-payload.json
    return 1
  fi
  cat "$out"
  rm -f "$out" /tmp/genre-presence-payload.json
}

echo "==> Project $PROJECT_REF"

# Realtime's own schema (realtime.messages, realtime.topic(), the daily message
# partitions) is created by the Realtime service's migrations, which run the first
# time a client connects — NOT at project creation. On 2026-08-25 this project's
# realtime schema was empty and the health endpoint said UNHEALTHY, purely because
# the app has never used realtime; one public-channel connection provisioned all
# 81 migrations. So warm the tenant before applying, or the migration's own guard
# correctly refuses to protect a table that does not exist yet.
echo "==> Warming the Realtime tenant (creates realtime.messages on a cold project)"
node "$APP_DIR/scripts/verify-presence.mjs" --warm

echo "==> Applying $(basename "$MIGRATION")"
run_sql "$(cat "$MIGRATION")" > /dev/null
echo "    applied"

echo "==> Checking both policies exist, on the right commands"
run_sql "
  select polname, polcmd::text as cmd
  from pg_policy
  where polrelid = 'realtime.messages'::regclass
  order by polname;
" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
got = {r["polname"]: r["cmd"] for r in rows}
want = {"presence_read_own_teams": "r", "presence_write_own_teams": "a"}
for k, v in want.items():
    print(f"    {k:26} cmd={got.get(k)!r} (want {v!r})")
extra = set(got) - set(want)
if extra:
    print(f"    NOTE other policies on realtime.messages: {sorted(extra)}")
sys.exit(0 if all(got.get(k) == v for k, v in want.items()) else 1)
'

echo "==> Checking RLS is on and anon holds no execute on the predicate"
run_sql "
  select
    (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass) as rls_on,
    has_function_privilege('anon','public.presence_topic_member(text)','execute')          as anon_exec,
    has_function_privilege('authenticated','public.presence_topic_member(text)','execute') as auth_exec;
" | python3 -c '
import json, sys
r = json.load(sys.stdin)[0]
expect = {"rls_on": True, "anon_exec": False, "auth_exec": True}
for k, v in expect.items():
    print(f"    {k:10} {str(r[k]):5} (want {v})")
sys.exit(0 if all(r[k] == v for k, v in expect.items()) else 1)
'

# A topic that is not presence:<uuid> must return FALSE, never raise. A raise
# inside a policy surfaces as a channel error on a topic that should simply be
# refused, and it would be indistinguishable from the transport being broken.
echo "==> Checking the topic parse fails closed instead of raising"
run_sql "
  select
    public.presence_topic_member(null)                              as t_null,
    public.presence_topic_member('')                                as t_empty,
    public.presence_topic_member('presence:not-a-uuid')             as t_garbage,
    public.presence_topic_member('presence:')                       as t_bare,
    public.presence_topic_member('sync_records')                    as t_other,
    public.presence_topic_member('presence:00000000-0000-0000-0000-000000000000') as t_absent;
" | python3 -c '
import json, sys
r = json.load(sys.stdin)[0]
bad = [k for k, v in r.items() if v is not False]
for k, v in r.items():
    print(f"    {k:10} {str(v):5} (want False)")
if bad:
    print(f"FAILED: {bad} did not fail closed", file=sys.stderr)
    sys.exit(1)
'

echo "==> Behavioural check: a member sees presence, a non-member is refused"
node "$APP_DIR/scripts/verify-presence.mjs"

echo "==> Done. Teammates can see each other; nobody else can see the team."
