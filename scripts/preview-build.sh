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
#
# `--with-unconfigured` additionally builds and serves a SECOND bundle on
# PORT+1 with VITE_SUPABASE_* blanked out. check-presence-live.mjs needs it: the
# claim "with Supabase unconfigured there is no channel and no error" is about a
# build where the client was never constructed, and it cannot be faked at runtime
# from a build that has the keys baked in.
set -euo pipefail

BASE="${VITE_BASE:-/genre-research-app/}"
PORT="${PORT:-4173}"
WITH_UNCONFIGURED=0
[ "${1:-}" = "--with-unconfigured" ] && WITH_UNCONFIGURED=1

cd "$(dirname "$0")/.."
VITE_BASE="$BASE" npm run build

if [ "$WITH_UNCONFIGURED" = "1" ]; then
  # An empty value set in the environment still counts as "already set", so Vite
  # keeps it and does not fall back to the value in .env.
  VITE_BASE="$BASE" VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= \
    npx vite build --outDir dist-nosb
  env VITE_BASE="$BASE" npx vite preview --outDir dist-nosb --port "$((PORT + 1))" --strictPort &
  echo
  echo "Unconfigured bundle at http://localhost:$((PORT + 1))${BASE}"
fi

echo
echo "Serving the built bundle at http://localhost:${PORT}${BASE}"
echo "Gates:  node scripts/check-sync-live.mjs  http://localhost:${PORT}${BASE}"
echo "        node scripts/check-two-device.mjs http://localhost:${PORT}${BASE}"
echo "        node scripts/check-team-live.mjs  http://localhost:${PORT}${BASE}"
if [ "$WITH_UNCONFIGURED" = "1" ]; then
  echo "        UNCONFIGURED_URL=http://localhost:$((PORT + 1))${BASE} \\"
  echo "          node scripts/check-presence-live.mjs http://localhost:${PORT}${BASE}"
fi
echo
exec env VITE_BASE="$BASE" npx vite preview --port "$PORT" --strictPort
