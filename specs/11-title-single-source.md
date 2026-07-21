# Spec 11 — Single-source-of-truth titles

**Request (Katie/Josh, 2026-07-20):** editing a page heading in dev mode (e.g.
"1a: Find Local Genres") must propagate everywhere that title appears — the
sidebar, the home workflow chart, the print chart, the Next/Back buttons, and
exports. Before this, titles were duplicated in code and only the page's own h1
updated.

Follow-up to spec 10's edit-in-place feature. Branch
`feature/two-workspace-redesign`. Content bumped 2.2.0 → 2.3.0.

## Root cause

Titles lived in three disconnected places:
1. `loader.ts` `JOURNEY[]` + `workspaces()` hardcoded all 8 stage titles and
   both workspace titles — these drove NavShell (sidebar), Dashboard (home
   chart), and PrintChart, none of them reading `guide-content.json`.
2. Per-page `<h1>` string literals in ChooseGenre / MacroCompare / StyleCompare
   / GenreSummary duplicated their own section's `label`, and those pages are
   routed away from WorksheetView so edit-in-place never reached them.
   `export.ts` hardcoded two more copies; ChooseGenre hardcoded "Go to 1a…".

Only WorksheetView's h1 and NavShell's nested sub-links actually read the
content `label`.

## Change

- **Titles derive from content.** `journey()` computes each stage's title from
  its source node's `label`: the single subsection for one-page stages, or a
  new `chrome` node for the "Describe a Genre" group and the "Genre Summary
  Table" route-only stage. `JourneyStage.titleNodeId` / `Workspace.titleNodeId`
  carry the source id so the UI can tag it. Workspace titles derive from the
  top-level section labels `s1` / `s0` (which already ARE the workspace names
  and are editable via the WorksheetView breadcrumb) — no new duplicate.
- **New `chrome: GuideNode[]`** top-level key in guide-content.json with exactly
  two prose nodes (`chrome.describe`, `chrome.summary`). Kept OUT of `sections`
  so nav/progress/routing never walk it; reached only via `findNode` (whose
  `nodeIndex()` now also walks `chrome`). The `/__content-edit` endpoint walks
  `[...sections, ...chrome]`, so both are editable in place.
- **Every consumer reads the derived title** and tags it with
  `data-dfb-node`/`data-dfb-field="label"`: NavShell stage links, group header,
  and workspace headings; Dashboard StageRow + WorkspacePanel; the four page
  h1s; PrintChart (no tags on the print sheet). Next/Back buttons on the
  Workspace-2 pages derive their neighbor's label too, so numbering never
  drifts. `export.ts` synthetic 2d rows derive section/subsection from `s0` /
  `s0.stylistic_notes`.
- **Shared `splitStageTitle()`** (exported from loader) replaces Dashboard's
  `splitTitle` and PrintChart's inline splitter; splits at the FIRST of `": "`
  or `" — "` (a label can contain both) and falls back to a `•` chip.
- **Fallbacks:** every derived string is `derived ?? current-literal`, so a
  missing/renamed node degrades to today's rendering rather than blanking.
  `resolveGenreTokens` renders `{genre}`/`{passage}` gracefully when unnamed
  (e.g. "2a: Focus on your passage").

## Coupling of record

Renaming the `s1` / `s0` section labels now also renames Workspace 1 / Workspace
2 everywhere, including the export "section" column. This is the intended
single-source coupling.

## Deferred

Help.tsx prose stage names (narrative, would drift); the five independent
app-name literals (index.html, guide-content `title` field, Dashboard h1,
PrintChart h1, report `REPORT_TITLE`); making JOURNEY/workspace blurbs editable
content (no blurb has an edit surface yet — reuse a chrome `guidance` field if
wanted later).

## Verification

`npm run build` clean; vitest 59/59 (new `tests/journeyTitles.test.ts`: 1-sub
stage titles === node labels + titleNodeId, describe/summary === chrome labels,
workspace titles === s1/s0 labels, splitStageTitle colon/both/legacy-dash/none
cases). `/__content-edit` exercised against `chrome.summary`: 200 apply, 409
stale, 404 unknown, byte-identical revert. Manual: edit the 1a h1 and confirm
the sidebar link, home chip+title, /chart, and the ChooseGenre "Go to…" link
all follow; edit the /choose h1 and confirm the sidebar "2b" renames; edit an
s1 breadcrumb and confirm both workspace headers rename.
