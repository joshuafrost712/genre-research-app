# Genre Research App (scaffold)

A guided, dictation-friendly tool for Katie Frost's *Local Genres Research for
Psalms Translation* worksheet. It walks a translation team through identifying a
culturally relevant genre, studying it with enough depth to translate well, and
carrying that study into a faithful translation of a focus text. The AI layer
(added later) proposes and prompts but never decides, so the team keeps ownership.

The offline core, the full worksheet content, both export paths, and AI routing
are built. AI routing follows the cairn pattern: Claude (Max) routes notes on a
GitHub repo or via a token-free copy/paste path — no metered API, no Supabase.
`genre-research-app` is a working name, renamable.

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
- **Export.** Long-format CSV and an AI-synthesis prompt offline; Google Sheets
  (tab per section) when a `VITE_GOOGLE_CLIENT_ID` is set.
- **AI routing (no metered API).** Claude (Max) proposes where each captured note
  belongs — via a private GitHub repo (`VITE_ROUTING_REPO` + an in-app token) or a
  token-free copy/paste path. Proposals arrive as needs-review entries; the Review
  screen confirms/edits/discards each. Nothing files silently.
- **Local-first.** Dexie/IndexedDB is the source of truth. The app runs fully
  offline; no account or backend is required.

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
`.env.example`): `VITE_GOOGLE_CLIENT_ID` for Sheets export, `VITE_ROUTING_REPO`
for automated GitHub routing. Everything else works with neither.
