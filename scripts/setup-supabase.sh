#!/usr/bin/env bash
# Provision (or re-attach to) the Supabase project that backs beta-tester
# sign-in for the Local Genres Research app, and write its URL + anon key into
# .env. Idempotent: if .env already has VITE_SUPABASE_URL it does nothing unless
# --force is passed. Auth is the ONLY thing Supabase does here — feedback still
# ships through the Apps Script sink.
#
# Prerequisite: a Supabase Personal Access Token, exported as SUPABASE_ACCESS_TOKEN
#   (generate at https://supabase.com/dashboard/account/tokens).
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_... ./scripts/setup-supabase.sh
#   SUPABASE_ACCESS_TOKEN=sbp_... PROJECT_REF=abcd ./scripts/setup-supabase.sh   # re-attach existing
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
PROJECT_NAME="${PROJECT_NAME:-genre-research-app-beta}"
REGION="${REGION:-us-east-1}"
SITE_URL="${SITE_URL:-https://joshuafrost712.github.io/genre-research-app/}"
# Redirect allow-list: the deployed app + local dev. Supabase matches these.
REDIRECTS="${REDIRECTS:-https://joshuafrost712.github.io/genre-research-app/,http://localhost:5173/,http://localhost:4173/}"

# Optional local fallback: on a maintainer's machine the token may be kept in a
# chmod-600 file outside any repo (nothing secret is committed here — just the
# path). Env var still wins if already set.
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$HOME/.claude/secrets/supabase.env" ]]; then
  # shellcheck disable=SC1091
  set -a; . "$HOME/.claude/secrets/supabase.env"; set +a
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: set SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)." >&2
  exit 1
fi
auth=(-H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}")

if grep -q '^VITE_SUPABASE_URL=..' "$ENV_FILE" 2>/dev/null && [[ "${1:-}" != "--force" ]]; then
  echo "VITE_SUPABASE_URL already set in .env — nothing to do (pass --force to re-provision)."
  exit 0
fi

# 1. Create the project (or re-attach if PROJECT_REF given).
if [[ -z "${PROJECT_REF:-}" ]]; then
  ORG_ID="${ORG_ID:-$(curl -fsSL "${auth[@]}" "$API/organizations" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')}"
  # openssl (no pipe) avoids a SIGPIPE that `tr </dev/urandom | head` triggers
  # under `set -o pipefail`.
  DB_PASS="$(openssl rand -hex 18)"
  echo "Creating project '$PROJECT_NAME' in org $ORG_ID ($REGION)…"
  PROJECT_REF="$(curl -fsSL "${auth[@]}" -H 'Content-Type: application/json' \
    -X POST "$API/projects" \
    -d "{\"name\":\"$PROJECT_NAME\",\"organization_id\":\"$ORG_ID\",\"region\":\"$REGION\",\"db_pass\":\"$DB_PASS\"}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
  echo "  ref=$PROJECT_REF (db password generated, not stored — reset in the dashboard if needed)"
fi

# 2. Wait until the project is healthy before configuring auth.
echo "Waiting for project to become ACTIVE_HEALTHY…"
for _ in $(seq 1 60); do
  STATUS="$(curl -fsSL "${auth[@]}" "$API/projects/$PROJECT_REF" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' || true)"
  echo "  status=$STATUS"
  [[ "$STATUS" == "ACTIVE_HEALTHY" ]] && break
  sleep 10
done

# 3. Configure email (magic-link) auth: enable email, set site + redirect allow-list.
echo "Configuring email auth + redirects…"
curl -fsSL "${auth[@]}" -H 'Content-Type: application/json' \
  -X PATCH "$API/projects/$PROJECT_REF/config/auth" \
  -d "{\"external_email_enabled\":true,\"site_url\":\"$SITE_URL\",\"uri_allow_list\":\"$REDIRECTS\"}" >/dev/null

# 4. Read the anon key and write .env.
ANON_KEY="$(curl -fsSL "${auth[@]}" "$API/projects/$PROJECT_REF/api-keys" \
  | python3 -c 'import sys,json; print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="anon"))')"
URL="https://$PROJECT_REF.supabase.co"

touch "$ENV_FILE"
# Upsert the two keys without disturbing other lines.
python3 - "$ENV_FILE" "$URL" "$ANON_KEY" <<'PY'
import sys, re
path, url, anon = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
have = {}
for i, l in enumerate(lines):
    for k in ("VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"):
        if l.startswith(k + "="):
            have[k] = i
def setk(k, v):
    if k in have: lines[have[k]] = f"{k}={v}"
    else: lines.append(f"{k}={v}")
setk("VITE_SUPABASE_URL", url)
setk("VITE_SUPABASE_ANON_KEY", anon)
open(path, "w").write("\n".join(lines) + "\n")
PY

echo "Done. Wrote VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY to $ENV_FILE"
echo "For the GitHub Pages build, add the same two vars to the deploy environment."
echo "Project ref: $PROJECT_REF"
