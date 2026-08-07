#!/usr/bin/env bash
# Reset one person's password and print the new one.
#
#   ./scripts/reset-beta-password.sh someone@example.org
#
# NO LONGER THE ROUTE. This was written when the project had no custom SMTP and
# the built-in mailer's two-per-hour project-wide cap made a "forgot password"
# email undeliverable often enough that the app deliberately did not offer one.
# Custom SMTP (Brevo relay, 100/hour) is now configured, so the app has a real
# self-serve reset: "Forgot your password?" in the sign-in dialog.
#
# Kept as the fallback for the cases that flow cannot serve — someone locked out
# of the email address on their account, or a delivery failure at a workshop with
# no time to debug it. It hands over a readable temporary password; the person
# changes it from the account menu once they are in.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.claude/secrets"

EMAIL="${1:-}"
if [[ -z "$EMAIL" ]]; then
  echo "usage: $0 <email>" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$SECRETS/supabase.env" ]]; then
  set -a; . "$SECRETS/supabase.env"; set +a
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN not set and $SECRETS/supabase.env not found." >&2
  exit 1
fi

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

# Find the account. The list is small enough to scan; matching here rather than
# trusting a server-side filter keeps the comparison case-insensitive and exact.
USER_ID="$(curl -fsS "$BASE/auth/v1/admin/users?per_page=200" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  | python3 -c '
import sys, json
want = sys.argv[1].strip().lower()
data = json.load(sys.stdin)
users = data.get("users", data if isinstance(data, list) else [])
print(next((u["id"] for u in users if (u.get("email") or "").lower() == want), ""))
' "$EMAIL")"

if [[ -z "$USER_ID" ]]; then
  echo "ERROR: no account found for $EMAIL." >&2
  echo "       Create one with ./scripts/create-beta-user.sh, or have them sign up in the app." >&2
  exit 1
fi

# Readable temp password: three words + two digits. They change it in-app anyway,
# and a password read aloud over a bad line needs to survive the trip.
PASSWORD="$(python3 - <<'PY'
import secrets, pathlib

FALLBACK = """river lantern maple cedar harbor meadow ember willow pebble cobalt
thicket amber quartz beacon cypress juniper marigold saffron indigo breeze""".split()

words = []
path = pathlib.Path('/usr/share/dict/words')
if path.exists():
    words = [
        w for w in path.read_text(errors='ignore').split()
        if 4 <= len(w) <= 7 and w.isalpha() and w.islower()
    ]
if len(words) < 2000:
    words = FALLBACK

print('-'.join(secrets.choice(words) for _ in range(3)) + '-' + str(secrets.randbelow(90) + 10))
PY
)"

RESP="$(curl -fsS -w $'\n%{http_code}' -X PUT "$BASE/auth/v1/admin/users/$USER_ID" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"password": sys.argv[1]}))' "$PASSWORD")" \
  2>/dev/null || true)"
CODE="$(printf '%s' "$RESP" | tail -1)"

if [[ "$CODE" == "200" ]]; then
  printf '%s\t%s\n' "$EMAIL" "$PASSWORD"
  echo "Hand this over, and tell them to change it from the account menu." >&2
else
  BODY="$(printf '%s' "$RESP" | sed '$d')"
  printf 'ERROR http %s: %s\n' "$CODE" "$(printf '%s' "$BODY" | head -c 200)" >&2
  exit 1
fi
