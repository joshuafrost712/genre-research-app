# Genre Research App (scaffold)

A guided, dictation-friendly tool for Katie Frost's *Local Genres Research for
Psalms Translation* worksheet. It walks a translation team through identifying a
culturally relevant genre, studying it with enough depth to translate well, and
carrying that study into a faithful translation of a focus text. The AI layer
(added later) proposes and prompts but never decides, so the team keeps ownership.

This is the **build-order step 1 scaffold**: Vite + React + TypeScript + Tailwind
+ PWA + Dexie, the worksheet-config loader, and a navigation shell with three-tap
access and reliable resume. The block renderer, capture, export, and the AI broker
come in later steps. `genre-research-app` is a working name, renamable.

The canonical plan lives in the Obsidian vault at
`Projects/AI Projects/Local Genres Research App - MVP Plan.md`.

## What works now

- **Worksheet as data.** The whole worksheet (sections, subsections, prompts,
  tables, depth tags) is bundled JSON at `src/content/guide-content.json`; the app
  renders over it. A small representative slice is seeded.
- **Three-tap navigation.** A persistent sidebar (a slide-over drawer on mobile)
  reaches any subsection in at most three taps. Section 2 and Section 3 are
  reachable in either order.
- **Depth modes.** Quick / Standard / Comprehensive filter the visible
  subsections, columns, and prompts. This is the anti-overwhelm mechanism.
- **Resume.** The last subsection opened is stored per project and offered on the
  home screen.
- **Local-first.** Dexie/IndexedDB is the source of truth. The app runs fully
  offline; no account or backend is required.

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

## Next build steps

2. Worksheet renderer: real inputs for every block type, CRUD on Entries.
3. Depth/review UX: progress vs visible set, not-applicable, priority stars,
   wizard vs section/review views.
4. Capture and manual routing of a dictated note to one or more nodes.
5. Genre bank (1B comparison) and Section 0 synthesis screens.
6. Export: CSV + AI-synthesis prompt, then Google Sheets matching Katie's layout.
7. AI broker (Supabase Edge Function): routing, synthesis, concern prompts.
8. Field-readiness pass and Bali rehearsal.
