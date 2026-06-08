# Genre Research App (scaffold)

A guided, dictation-friendly tool for Katie Frost's *Local Genres Research for
Psalms Translation* worksheet. It walks a translation team through identifying a
culturally relevant genre, studying it with enough depth to translate well, and
carrying that study into a faithful translation of a focus text. The AI layer
(added later) proposes and prompts but never decides, so the team keeps ownership.

Build-order steps 1–6 are done (the offline core). The AI broker (step 7) and
Google Sheets export are deferred because they need external secrets / OAuth
config. `genre-research-app` is a working name, renamable.

The canonical plan lives in the Obsidian vault at
`Projects/AI Projects/Local Genres Research App - MVP Plan.md`.

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
- **Export.** Long-format CSV and an AI-synthesis prompt, fully offline.
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

## Remaining build steps

- Google Sheets export (tab per section, matching Katie's layout) via client-side
  GIS `drive.file`. Needs a Google OAuth client id.
- AI broker (Supabase Edge Function): AI-proposed routing with a needs-review
  flow, AI-proposed distinctive features for synthesis, and question-form concern
  prompts. Needs the Supabase project + Claude key.
- 1B genre-comparison grid (each 1B row as a first-class genre across genres) and
  the Section 0 synthesis screens, building on the genre/focus-text model.
- Field-readiness pass and Bali rehearsal.
