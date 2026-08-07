#!/usr/bin/env bash
# Turn on self-serve account creation, gated by a shared invite code.
#
#   ./scripts/enable-signup.sh
#
# What it does, in order: deploys the `signup` Edge Function, hands it the invite
# code as a Supabase secret, turns OFF public signup on the project so the anon key
# can no longer mint accounts, and then proves both halves with probes that create
# nothing. Idempotent; safe to re-run after editing the function.
#
# Why an invite code at all: a valid Supabase JWT is what authorizes the `translate`
# function to spend a metered API key, so an ungated signup form would put that key
# behind nothing more than a free account. The code is the wall.
#
# The code is read from a FILE, never passed as an argument, same convention as the
# other secrets here. If the file is missing or empty the script generates a strong
# code, writes it, and prints it once for you to paste into the invite email.
#
#   ~/.claude/secrets/genre-invite.env   SIGNUP_INVITE_CODE=four-random-words-here
#
# To rotate: blank the value in that file and re-run. Anyone who already has an
# account keeps it; only new signups need the new code.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.claude/secrets"
INVITE_FILE="$SECRETS/genre-invite.env"

# --- Supabase access token -----------------------------------------------------
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$SECRETS/supabase.env" ]]; then
  set -a; . "$SECRETS/supabase.env"; set +a
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN not set and $SECRETS/supabase.env not found." >&2
  exit 1
fi

# --- Invite code ---------------------------------------------------------------
if [[ -z "${SIGNUP_INVITE_CODE:-}" && -f "$INVITE_FILE" ]]; then
  set -a; . "$INVITE_FILE"; set +a
fi

GENERATED=0
if [[ -z "${SIGNUP_INVITE_CODE:-}" ]]; then
  # Four words plus three digits, drawn with a CSPRNG from a CURATED list of common
  # words. The list is ~100 words, so this carries about 36 bits. That is far past
  # what the function's per-IP throttle would ever let anyone try, and the code is
  # not the only thing standing between a stranger and anything valuable.
  #
  # Deliberately NOT /usr/share/dict/words. That has more entropy per word and
  # produced "unscrew-ayllu-geneat-pasang" on the first run: three of those four are
  # words nobody can copy off a phone screen without a typo. A code people mistype
  # is the same friction this whole change exists to remove.
  #
  # FORMAT IS QUOTED ELSEWHERE. Four words plus three digits is stated to users in
  # two places that must be changed with it: the hint under the invite field
  # (src/components/account/AccountDialog.tsx) and the rejection message in
  # supabase/functions/signup/index.ts. Someone read "four words and a three-digit
  # number" and found the digit they had dropped, so the wording earns its keep —
  # but only while it is true.
  SIGNUP_INVITE_CODE="$(python3 - <<'PY'
import secrets

WORDS = """river lantern maple cedar harbor meadow ember willow pebble cobalt
thicket amber quartz beacon cypress juniper marigold saffron indigo breeze cavern
dune fjord glade summit tide valley wren zephyr lattice compass anchor bramble
copper garden hollow island kettle ladder mantle needle orchard pillar quiver
ribbon saddle timber velvet walnut yellow almond basket candle daisy eagle
feather granite hammer ivory jasmine kernel lemon marble nutmeg olive parcel
quarry rabbit silver tulip umber violet willow yarrow acorn birch clover
dolphin elder fennel ginger heather indigo jasper kelp linen mallow
nectar oyster peach quince raven sorrel thistle umbra vessel wheat
yonder zinnia bluff creek dawn ferry grove haven inlet""".split()

code = '-'.join(secrets.choice(WORDS) for _ in range(4))
print(f'{code}-{secrets.randbelow(900) + 100}')
PY
)"
  GENERATED=1
  mkdir -p "$SECRETS"
  # Rewrite the file rather than appending, so rotation does not leave two values
  # where a later `source` silently picks the wrong one.
  cat > "$INVITE_FILE" <<EOF
# Shared invite code for genre-research-app self-serve signup.
# Give this to the people you are inviting. To rotate: blank the value, then
# re-run scripts/enable-signup.sh. Keep this file out of any git repo.
SIGNUP_INVITE_CODE=$SIGNUP_INVITE_CODE
EOF
  chmod 600 "$INVITE_FILE"
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
FN_URL="$BASE/functions/v1/signup"

# --- Deploy + secret -----------------------------------------------------------
# --no-verify-jwt is REQUIRED here, not a convenience: a person creating their first
# account has no JWT to present. It turns off the platform gate only. The invite code
# and the per-IP throttle inside index.ts are the entire authorization from here on.
echo "==> Deploying the signup function"
supabase functions deploy signup --project-ref "$PROJECT_REF" --no-verify-jwt

echo "==> Setting the invite code as a Supabase secret"
supabase secrets set "SIGNUP_INVITE_CODE=$SIGNUP_INVITE_CODE" \
  --project-ref "$PROJECT_REF" >/dev/null
echo "    set (value not echoed)"

# --- Close the public door ------------------------------------------------------
# With signup disabled, the anon key cannot create accounts at all; the Admin API
# the function uses is unaffected. Without this step the invite code would be
# decoration, because anyone could call /auth/v1/signup directly.
echo "==> Disabling public signup on the project"
curl -fsS -X PATCH "$API/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"disable_signup": true}' >/dev/null
echo "    disable_signup = true"

# --- Prove it -------------------------------------------------------------------
echo "==> Verifying (probes create nothing)"

# A deliberately wrong code. 403 means the function is live and the gate works;
# 503 means the secret has not landed yet.
for attempt in 1 2 3 4 5; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN_URL" \
    -H 'Content-Type: application/json' \
    -d '{"name":"probe","email":"probe@example.com","password":"probe-probe","code":"definitely-not-the-code"}')"
  [[ "$CODE" == "503" ]] || break
  sleep 3   # a warm isolate can briefly hold the old, secretless environment
done

case "$CODE" in
  403) echo "    gate OK: a wrong invite code is refused." ;;
  503) echo "FAILED: the function still reports no invite code configured." >&2; exit 1 ;;
  *)   echo "Unexpected status $CODE from $FN_URL — check the function logs." >&2; exit 1 ;;
esac

# The anon key must no longer be able to create an account on its own.
ANON_KEY="$(curl -fsSL -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "$API/projects/$PROJECT_REF/api-keys" \
  | python3 -c 'import sys,json; print(next(k["api_key"] for k in json.load(sys.stdin) if k["name"]=="anon"))')"
DIRECT="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/v1/signup" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"probe-direct@example.com","password":"probe-probe-probe"}')"
if [[ "$DIRECT" == "422" || "$DIRECT" == "403" || "$DIRECT" == "400" ]]; then
  echo "    door OK: the anon key cannot create accounts directly (http $DIRECT)."
else
  echo "FAILED: direct anon signup returned http $DIRECT — expected a refusal." >&2
  echo "        disable_signup may not have taken effect; accounts are open." >&2
  exit 1
fi

cat <<EOF

Self-serve signup is on. People create an account from the app header:
"Sign in" then "Create an account". Any email address works; no Google needed.

EOF

if [[ "$GENERATED" == "1" ]]; then
  cat <<EOF
Your invite code (generated just now, saved to $INVITE_FILE):

    $SIGNUP_INVITE_CODE

Put it in the invite email. It is not printed again.
EOF
else
  echo "Invite code: unchanged, read from $INVITE_FILE."
fi

cat <<EOF

Function URL: $FN_URL
Logs:         https://supabase.com/dashboard/project/$PROJECT_REF/functions/signup/logs
EOF
