#!/usr/bin/env bash
# Install (or reinstall) the launchd job that polls the Google Sheet for new
# app feedback every 30 min and writes it into feedback/incoming/.
#
#   Install / update:  bash scripts/feedback-poller/install.sh
#   Stop & remove:      bash scripts/feedback-poller/install.sh uninstall
#
# Requires feedback/.pull.json to exist (the live URL + token). Safe to re-run.
set -euo pipefail

LABEL="com.genreapp.feedback-poller"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST_SRC="$REPO/scripts/feedback-poller/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

uninstall() {
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST_DEST"
  echo "Removed $LABEL. Kill path complete — poller no longer runs."
}

if [[ "${1:-}" == "uninstall" ]]; then
  uninstall
  exit 0
fi

if [[ ! -f "$REPO/feedback/.pull.json" ]]; then
  echo "ERROR: $REPO/feedback/.pull.json not found."
  echo "Copy feedback/.pull.example.json to feedback/.pull.json and fill in the"
  echo "web-app URL + token first."
  exit 1
fi

NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed -e "s#__NODE__#$NODE_BIN#g" -e "s#__REPO__#$REPO#g" "$PLIST_SRC" > "$PLIST_DEST"

# Reload cleanly.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST_DEST"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "Installed $LABEL (polls every 30 min)."
echo "  Log:        $REPO/feedback/poller.log"
echo "  Run now:    launchctl kickstart -k $DOMAIN/$LABEL"
echo "  Stop/kill:  bash scripts/feedback-poller/install.sh uninstall"