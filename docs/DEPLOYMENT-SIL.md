# Deploying the Genre Research App on SIL infrastructure

For SIL's technology team. This describes hosting the **Genre Research App** (a
guided, dictation-friendly tool for the *Local Genres Research for Psalms
Translation* worksheet) as an official SIL-hosted website, alongside ThruLine.

It is architecturally the **same stack** as ThruLine (React + Vite + TypeScript PWA,
IndexedDB-first, GitHub Pages today), so most of this mirrors
`cairn/docs/DEPLOYMENT-SIL.md`. The differences are called out below.

## What it is, in one paragraph

A **100% static frontend PWA** that renders the research worksheet from bundled JSON
and stores everything the team enters in the browser's IndexedDB. It works fully
offline. **Today it needs no backend at all** — there is no Supabase usage in the
shipped code; the whole worksheet, both export paths, and the AI note-routing run
locally or through a token-free copy/paste path. Two features are *optional and
opt-in*: Google sign-in (for Google Sheets export and cross-device sync) and a
future server-side AI drafting broker.

## What SIL needs to provide

1. **Static web hosting over HTTPS**, with SPA fallback (serve `index.html` for
   unknown paths) and either root-domain hosting (default `VITE_BASE=/`) or a
   configured subpath. HTTPS is mandatory for PWA install/offline. Identical
   requirement to ThruLine.
2. **A build step:** Node 22 (its CI uses 22; 20+ is fine), `npm ci && npm run
   build`, output is static `dist/`. Current CI: `.github/workflows/deploy.yml`.
3. **Nothing else is required** for the core app. The items below are optional.

## Build-time configuration

All config is `VITE_*` build variables (see `.env.example`).

| Variable | Required? | Purpose |
|---|---|---|
| `VITE_BASE` | if subpath | base path (e.g. `/genre/`); default `/` |
| `VITE_GOOGLE_CLIENT_ID` | optional | Google OAuth Web client id → enables Sheets export, cloud sync, Teams. A public client identifier, not a secret. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | optional | only if the future AI-broker backend is enabled |
| `VITE_ROUTING_REPO`, `VITE_ROUTING_BRANCH` | optional | private GitHub repo for automated AI note-routing (copy/paste fallback needs none) |

## Optional pieces (only if SIL wants them)

- **Google OAuth** (`VITE_GOOGLE_CLIENT_ID`): register a Web OAuth client in Google
  Cloud, add the SIL deploy origin (and `http://localhost` for dev) to the
  authorized JavaScript origins. Scopes are requested incrementally in-browser
  (`drive.file` for personal sync/Sheets; full `drive` only when joining a team).
  Until the OAuth app is verified, Google shows an "unverified app" screen; for a
  pilot, add users as OAuth "Test users" (<100). No client secret is used.

- **AI drafting broker (future).** The app's `.env.example` contemplates a
  server-side AI broker. To match ThruLine, implement it the same way: a Supabase
  **Edge Function** holding the model key server-side (Gemini free tier), never a
  key in the client bundle. See `cairn/docs/SELF-HOST-SUPABASE.md` for standing up
  Supabase, and `cairn/supabase/functions/draft-scenario/` as the reference
  Edge-Function pattern. The same Gemini free-tier data-handling caveat applies:
  prefer a paid tier or an alternative provider for confidential content.

## Data storage

All research data is on-device (IndexedDB) unless Google sign-in is enabled, in
which case the user's own Google Drive/Sheets holds their synced copy. There is no
central application database today. If SIL later enables the Supabase-backed
broker, that backend handles only AI brokering, not primary data.

## Verification after deploying

1. Load over HTTPS; confirm the worksheet renders and "Install app" is offered.
2. Work a few worksheet fields and reload; confirm answers persist (IndexedDB).
3. If Google OAuth is configured: sign in and confirm a Sheets export succeeds.