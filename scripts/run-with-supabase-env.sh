#!/bin/bash
# Run a command with ~/.claude/secrets/supabase.env loaded. Local convenience
# for the check-* harnesses; never echoes the secrets.
set -euo pipefail
set -a
source "$HOME/.claude/secrets/supabase.env"
set +a
exec "$@"
