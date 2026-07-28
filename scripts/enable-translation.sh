#!/usr/bin/env bash
# Turn on instant (Lane A) translation of the answers a team types, using
# ANTHROPIC (Claude Haiku 4.5) as the engine.
#
#   ./scripts/enable-translation.sh
#
# For the GOOGLE engine instead, use `npm run translate:google`. The two are
# interchangeable at runtime through the TRANSLATE_ENGINE secret; the trade is
# terminology and context (Anthropic reads the worksheet question and the glossary
# as instructions) against a little cost and latency (Google is ~$0 inside its
# 500K-characters-a-month free tier, and ~300ms rather than ~1s).
#
# What it does, in order: deploys the `translate` Edge Function, hands it the
# Anthropic key as a Supabase secret, and proves the key landed. Idempotent —
# safe to re-run after editing the function or the glossary.
#
# The key is read from a FILE, never passed as an argument. A key on a command
# line ends up in shell history and in the process list; a key in a 600-mode file
# outside any git repo does not. Same convention as the Supabase token.
#
#   ~/.claude/secrets/anthropic.env   ANTHROPIC_API_KEY=sk-ant-...
#
# Create the key at https://console.anthropic.com/settings/keys. Expected pilot
# spend is single-digit dollars (Haiku 4.5, ~1-2M characters across five teams);
# set a monthly limit on the key anyway, since the Edge Function's own rate limit
# is a runaway-loop guard, not a billing control.
set -euo pipefail

API="https://api.supabase.com/v1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$HOME/.claude/secrets"
ANTHROPIC_FILE="$SECRETS/anthropic.env"

# --- Supabase access token -----------------------------------------------------
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -f "$SECRETS/supabase.env" ]]; then
  set -a; . "$SECRETS/supabase.env"; set +a
fi
if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN not set and $SECRETS/supabase.env not found." >&2
  exit 1
fi

# --- Anthropic key -------------------------------------------------------------
if [[ -z "${ANTHROPIC_API_KEY:-}" && -f "$ANTHROPIC_FILE" ]]; then
  set -a; . "$ANTHROPIC_FILE"; set +a
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  mkdir -p "$SECRETS"
  if [[ ! -f "$ANTHROPIC_FILE" ]]; then
    cat > "$ANTHROPIC_FILE" <<'TEMPLATE'
# Anthropic API key for the genre-research-app translate Edge Function.
# Create at https://console.anthropic.com/settings/keys, paste below, save,
# then re-run scripts/enable-translation.sh. Keep this file out of any git repo.
ANTHROPIC_API_KEY=
TEMPLATE
    chmod 600 "$ANTHROPIC_FILE"
    echo "Created $ANTHROPIC_FILE (mode 600)."
  fi
  echo "ERROR: ANTHROPIC_API_KEY is empty." >&2
  echo "  1. Create a key: https://console.anthropic.com/settings/keys" >&2
  echo "  2. Paste it into $ANTHROPIC_FILE" >&2
  echo "  3. Re-run this script." >&2
  exit 1
fi
# Catch a paste that grabbed the wrong string before spending a deploy on it.
if [[ "$ANTHROPIC_API_KEY" != sk-ant-* ]]; then
  echo "ERROR: ANTHROPIC_API_KEY does not look like an Anthropic key (expected sk-ant-…)." >&2
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
FN_URL="https://$PROJECT_REF.supabase.co/functions/v1/translate"

# --- The prompt contract must match the source it was generated from -----------
# The function cannot import from src/, so it carries a rendered copy. Deploying a
# stale one would serve the wrong terminology with no visible error.
echo "==> Checking the prompt contract is current"
( cd "$APP_DIR" && npm run --silent i18n:contract )
if ! git -C "$APP_DIR" diff --quiet -- supabase/functions/translate/contract.generated.json; then
  echo "NOTE: contract.generated.json was regenerated and differs from the commit." >&2
  echo "      Deploying the fresh one; commit it so the drift test passes." >&2
fi

# --- Deploy + secret -----------------------------------------------------------
# --no-verify-jwt turns off the PLATFORM gate only. The function still demands a
# Supabase user JWT itself (see index.ts), and doing the check in our own code is
# what lets an unauthenticated caller get a JSON 401 with CORS headers instead of
# an opaque platform rejection the browser cannot read.
echo "==> Deploying the translate function"
supabase functions deploy translate --project-ref "$PROJECT_REF" --no-verify-jwt

echo "==> Setting the Anthropic key as a Supabase secret, and selecting the engine"
# TRANSLATE_ENGINE defaults to google, so setting the key alone would leave the
# proxy pointed at the other engine and this script apparently doing nothing.
supabase secrets set "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" TRANSLATE_ENGINE=anthropic \
  --project-ref "$PROJECT_REF" >/dev/null
echo "    set (value not echoed)"

# --- Prove it ------------------------------------------------------------------
# An unauthenticated POST is the free health check: 503 means the function has no
# key, 401 means it has one and is now asking who you are. Costs nothing, because
# the key check runs before any model call.
echo "==> Verifying (unauthenticated probe, no model call, no spend)"
for attempt in 1 2 3 4 5; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN_URL" \
    -H 'Content-Type: application/json' \
    -d '{"text":"probe","targetLocale":"id"}')"
  [[ "$CODE" == "503" ]] || break
  sleep 3   # a warm isolate can briefly hold the old, keyless environment
done

case "$CODE" in
  401) echo "OK: the key is live and the function is asking callers to sign in." ;;
  503) echo "FAILED: still reporting 'translation is not configured'." >&2; exit 1 ;;
  *)   echo "Unexpected status $CODE from $FN_URL — check the function logs." >&2; exit 1 ;;
esac

cat <<EOF

Instant translation is on. Two things to know:

  * Testers reach it at <app-url>?beta=1 and must sign in — the proxy identifies
    callers by their Supabase account. Create accounts with
    ./scripts/create-beta-user.sh <email> "Full Name"
  * VITE_TRANSLATE_URL is already a repo Actions variable, so the deployed site
    points here. No site rebuild is needed for this change to take effect.

Function URL: $FN_URL
Logs:         https://supabase.com/dashboard/project/$PROJECT_REF/functions/translate/logs
EOF
