# Genre Research App (scaffold)

A guided, dictation-friendly tool for Katie Frost's *Local Genres Research for
Psalms Translation* worksheet. It walks a translation team through identifying a
culturally relevant genre, studying it with enough depth to translate well, and
carrying that study into a faithful translation of a focus text. The AI layer
(added later) proposes and prompts but never decides, so the team keeps ownership.

The offline core, the full worksheet content, every export path, and AI routing
are built. AI routing follows the cairn pattern: Claude (Max) routes notes on a
GitHub repo or via a token-free copy/paste path, with no metered API. A Supabase
project was added later for two optional things only: accounts, and the auth check
on live answer translation. `genre-research-app` is a working name, renamable.

The canonical plan lives in the Obsidian vault at
`Projects/AI Projects/Local Genres Research App - MVP Plan.md`.

## Try it on a phone

Live (auto-deployed from `main` via GitHub Pages):
**https://joshuafrost712.github.io/genre-research-app/**

Install on Android (Chrome): open the link → ⋮ menu → **Install app** (or **Add to
Home Screen**). It installs with an icon, opens full-screen, and works offline
after the first load. On iOS (Safari): Share → **Add to Home Screen**.

First run: open **Genres & focus texts**, name the focus text and genre, then work
the worksheet (or the guided wizard) and capture observations. Start in **Quick**
depth. Data is stored only on that device.

## What works now

- **Worksheet as data.** The whole worksheet (sections, subsections, prompts,
  tables, depth tags) is bundled JSON at `src/content/guide-content.json`; the app
  renders over it. A representative slice (Sections 0, 1A, 1B, 2A, 3A) is seeded.
- **Full block renderer.** Real inputs for short/long text (debounced autosave),
  single/multi-select, three-point scale, repeatable list, repeatable-row table,
  fixed grid, group, and prose — all autosaving to IndexedDB.
- **Three-tap navigation + two ways through.** A persistent sidebar (slide-over
  drawer on mobile) reaches any subsection in three taps; a guided wizard walks
  one question at a time. Sections 2 and 3 are reachable in either order.
- **Depth modes.** Quick / Standard / Comprehensive filter visible subsections,
  columns, and prompts. The anti-overwhelm mechanism.
- **Progress, not-applicable, priorities.** Answered-vs-visible progress overall
  and per subsection; a per-block N/A toggle (a recorded decision, not a blank);
  priority stars on feature rows feeding a "Your priorities" page.
- **Capture + routing.** Dictate an observation (Wispr / native dictation into
  the field), save it as an immutable note, then route it to one or more
  worksheet nodes; provenance is kept.
- **Genres & focus texts.** Create / rename / switch focus texts and genres; the
  worksheet re-points to the active pairing. Genre analysis is reusable.
- **Export.** Word, PDF, long-format CSV and an AI-synthesis prompt, all built in
  the browser with no account and no connectivity; Google Sheets (tab per section)
  additionally when a `VITE_GOOGLE_CLIENT_ID` is set.
- **AI routing (no metered API).** Claude (Max) proposes where each captured note
  belongs — via a private GitHub repo (`VITE_ROUTING_REPO` + an in-app token) or a
  token-free copy/paste path. Proposals arrive as needs-review entries; the Review
  screen confirms/edits/discards each. Nothing files silently.
- **Local-first.** Dexie/IndexedDB is the source of truth. The app runs fully
  offline; no account or backend is required, and no route is auth-guarded.
- **Accounts (optional).** Supabase email and password, usable with *any* address.
  Creating one goes through an invite-code-gated Edge Function
  (`supabase/functions/signup`, deployed by `scripts/enable-signup.sh`), because
  public signup would put the translation engine's metered key behind nothing but a
  free account. An account tags feedback to a person and authorizes live
  translation. It is unrelated to Google: Google sign-in is a separate, optional
  connection whose only job is saving a copy of the work to that person's Drive.
  There is no self-serve password reset while the project has no custom SMTP; use
  `scripts/reset-beta-password.sh`.

## Testing

```bash
npm test           # vitest: core CRUD, routing, progress, and export logic
```

## Tech

- React + Vite + TypeScript, installable **PWA** (`vite-plugin-pwa`).
- **Dexie** (IndexedDB) on-device store (`src/lib/storage/`), with `sync_status`
  fields reserved so a Supabase outbox can be added without migration.
- **Tailwind CSS v4** via `@tailwindcss/vite`.
- Aligned with the `cairn` evaluation app so the two stay symmetric.

## Setup

```bash
npm install
npm run dev        # http://localhost:5173 — runs local-only, no backend needed
```

There is nothing to configure to run the worksheet. `.env` values (see
`.env.example`) are only needed once the AI broker (step 7) is wired up; project
data stays local until then.

### Desktop launcher

For one-click local use there is a "Genre App" icon on the Desktop. Double-click
it: it starts the dev server (if not already running) and opens
`http://localhost:5173/` in the default browser.

The launcher is a small macOS `.app` bundle built from two committed files:

- `scripts/launch-local.sh` — the actual launch logic (start/reuse vite, then `open`).
- `scripts/install-launcher.command` — idempotently (re)builds `~/Desktop/Genre App.app`.

If the Desktop app is ever missing or stops working, rebuild it with:

```bash
bash scripts/install-launcher.command
```

The bundle deliberately *interprets* `launch-local.sh` (`/bin/bash "$SCRIPT"`)
rather than executing it directly, so macOS Gatekeeper does not block the
unsigned script (which previously broke the browser auto-open).

## Layout

```
src/
  content/guide-content.json   worksheet content (single source of truth)
  schema/types.ts              worksheet schema types + depth helpers
  lib/content/loader.ts        content access, node index, nav tree, prev/next
  lib/types.ts                 persisted entity records (layered data model)
  lib/storage/db.ts            Dexie stores
  lib/storage/appState.ts      active project + resume cursor
  components/                  DepthMode context, NavShell, Layout
  pages/                       Dashboard, WorksheetView (placeholder renderer)
```

## Remaining

- **Guidance text per node** — the "how to think / how much is enough" helper for
  each worksheet node. The schema reserves a `guidance` slot; Katie writes the
  content. This is the main gate to field-readiness.
- AI **synthesis** (propose distinctive features to carry forward) and **concern
  prompts** (question-form mismatch flags), reusing the same GitHub / copy-paste
  routing mechanism with different task content.
- 1B genre-comparison grid (each 1B row as a first-class genre across genres).
- Field-readiness pass and Bali rehearsal.

To enable the optional integrations, set the env vars in `.env` (see
`.env.example`): `VITE_GOOGLE_CLIENT_ID` for Drive and Sheets export,
`VITE_ROUTING_REPO` for automated GitHub routing, and `VITE_SUPABASE_URL` +
`VITE_SUPABASE_ANON_KEY` for accounts and live translation. Everything else works
with none of them.
