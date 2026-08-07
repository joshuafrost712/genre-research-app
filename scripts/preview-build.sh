#!/usr/bin/env bash
# Build and serve exactly what GitHub Pages will serve, for the check scripts.
#
#   scripts/preview-build.sh          # then: node scripts/check-two-device.mjs http://localhost:4173/genre-research-app/
#
# VITE_BASE has to be set for BOTH the build and the preview server, and the
# failure when it is not is thoroughly misleading. Set it only on the build and
# `vite preview` serves dist at "/", so index.html asks for
# /genre-research-app/assets/* and the page renders blank: the check scripts then
# report that sync is broken, when nothing ever booted. Set it on neither and the
# router 404s while the sync engine keeps running headlessly, which is worse —
# the gates pass against a page no human could have used.
#
# So: one variable, one place, both processes.
set -euo pipefail

BASE="${VITE_BASE:-/genre-research-app/}"
PORT="${PORT:-4173}"

cd "$(dirname "$0")/.."
VITE_BASE="$BASE" npm run build

echo
echo "Serving the built bundle at http://localhost:${PORT}${BASE}"
echo "Gates:  node scripts/check-sync-live.mjs  http://localhost:${PORT}${BASE}"
echo "        node scripts/check-two-device.mjs http://localhost:${PORT}${BASE}"
echo "        node scripts/check-team-live.mjs  http://localhost:${PORT}${BASE}"
echo
exec env VITE_BASE="$BASE" npx vite preview --port "$PORT" --strictPort
