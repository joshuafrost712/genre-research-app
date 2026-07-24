#!/usr/bin/env bash
# Create ONE confirmed beta-tester account (email + generated password) via the
# Supabase Admin API, so a small invited group can sign in immediately with no
# email sent (the built-in magic-link email is rate-limited). Prints the
# generated password on stdout for you to hand to the tester; they can change it
# in-app afterward. Idempotent-ish: if the email already exists it reports that
# and changes nothing.
#
#   ./scripts/create-beta-user.sh <email> [full name]
#
# Token: reuses SUPABASE_ACCESS_TOKEN (or ~/.claude/secrets/supabase.env).
# Project: derived from .env's VITE_SUPABASE_URL, or set PROJECT_REF.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EMAIL="${1:-}"
NAME="${2:-}"
[[ -z "$EMAIL" ]] && { echo "usage: $0 <email> [full name]" >&2; exit 1; }

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$HOME/.claude/secrets/supabase.env" ]]; then
  set -a; . "$HOME/.claude/secrets/supabase.env"; set +a
fi
[[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]] && { echo "ERROR: SUPABASE_ACCESS_TOKEN not set." >&2; exit 1; }

if [[ -z "${PROJECT_REF:-}" ]]; then
  URL="$(grep '^VITE_SUPABASE_URL=' "$APP_DIR/.env" | cut -d= -f2-)"
  PROJECT_REF="$(printf '%s' "$URL" | sed -E 's#https?://([^.]+)\..*#\1#')"
fi
[[ -z "$PROJECT_REF" ]] && { echo "ERROR: could not determine PROJECT_REF." >&2; exit 1; }

# service_role key (project admin) — fetched at runtime, never stored.
SERVICE_KEY="$(curl -fsSL -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "$API/projects/$PROJECT_REF/api-keys" \
  | python3 -c 'import sys,json; print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="service_role"))')"
BASE="https://$PROJECT_REF.supabase.co"

# Readable, strong-enough temp password: three words + two digits (no pipe →
# no SIGPIPE under pipefail). They will change it in-app anyway.
WORDS=(river lantern maple cedar harbor meadow ember willow pebble cobalt
       thicket amber quartz meadow beacon cypress juniper marigold saffron indigo
       breeze cavern dune fjord glade summit tide vale wren zephyr)
rand() { echo $(( RANDOM % ${#WORDS[@]} )); }
PASSWORD="${WORDS[$(rand)]}-${WORDS[$(rand)]}-${WORDS[$(rand)]}-$(( RANDOM % 90 + 10 ))"

RESP="$(curl -fsS -w $'\n%{http_code}' -X POST "$BASE/auth/v1/admin/users" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"email":sys.argv[1],"password":sys.argv[2],"email_confirm":True,"user_metadata":({"name":sys.argv[3]} if sys.argv[3] else {})}))' "$EMAIL" "$PASSWORD" "$NAME")" \
  2>/dev/null || true)"
CODE="$(printf '%s' "$RESP" | tail -1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"

if [[ "$CODE" == "200" || "$CODE" == "201" ]]; then
  printf '%s\t%s\t%s\n' "$EMAIL" "$PASSWORD" "${NAME:-}"
elif printf '%s' "$BODY" | grep -qiE 'already|registered|exists'; then
  printf '%s\t(already exists — unchanged)\t%s\n' "$EMAIL" "${NAME:-}"
else
  printf '%s\tERROR http %s: %s\n' "$EMAIL" "$CODE" "$(printf '%s' "$BODY" | head -c 200)" >&2
  exit 1
fi
