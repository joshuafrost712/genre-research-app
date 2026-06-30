#!/bin/bash
# Launch (or re-open) the Local Genres Research app on localhost.
# Safe to run repeatedly: if the server is already up it just opens the browser.

APP_DIR="$HOME/Documents/GitHub/genre-research-app"
PORT=5173
URL="http://localhost:$PORT/"
LOG="$APP_DIR/dev-server.log"

# Homebrew node/npm aren't on the PATH when launched from Finder; add them.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$APP_DIR" || { echo "Cannot find $APP_DIR"; exit 1; }

is_up() { curl -sf -o /dev/null "$URL"; }

if is_up; then
  echo "Server already running at $URL"
else
  echo "Starting dev server..."
  # Kill any stale vite for this project, then start fresh and detached.
  pkill -f "$APP_DIR/node_modules/.bin/vite" 2>/dev/null
  pkill -f "vite.*genre-research-app" 2>/dev/null
  nohup npm run dev -- --port "$PORT" --strictPort > "$LOG" 2>&1 &
  # Wait up to ~30s for it to answer.
  for i in $(seq 1 60); do
    sleep 0.5
    is_up && break
  done
fi

if is_up; then
  echo "Opening $URL"
  open "$URL"
else
  echo "Server did not come up. See log: $LOG"
  open "$LOG"
fi