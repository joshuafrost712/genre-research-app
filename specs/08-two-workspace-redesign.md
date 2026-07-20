# Spec 08 — The two-workspace redesign (2026-07-20)

**Source:** Katie's "Discovering Genres" OBT-CDT #3 deck + her two-workspace
sketch, processed with Josh; twelve decisions locked in dialogue 2026-07-18.
The full mapping document lives in the vault:
`Projects/AI Projects/Genre App — Two-Workspace Redesign Map.md`.

## What changed

The app reorganized from one worksheet (Sections 0–3 around an active
psalm-genre pairing) into two workspaces reached from a home screen that IS the
workflow chart.

**Workspace 1 — Find & Describe Local Genres** (standalone ethnography):
1a genre list first + asking prompts (`s1a`), 1b genre basics with purpose
families (`s1b`, many-to-many), 1c social side (`s2eth`, now holding
associations + vitality + made-up-vs-planned), 1d big picture ×4
(`s2b/s2a/s2c/s2d`), 1e style ×6 (`s3a`–`s3f`, every page gains a Required /
Common feature table with a localizable explainer), 1f genre summary table
(`/summary`: rows = genres, columns = features, configurable + reorderable,
purpose-coverage panel).

**Workspace 2 — Create / Translate** (passage-generic): 2a passage setup
(`s0.setup`, intended-use relocated per feedback #18), 2b genre chooser
(`/choose`: purpose comparison → top-3 shortlist with recoverable set-aside →
social comb with per-passage green/yellow/red fit flags → lock-in with the
guard dialog whose confirm reads **"We have a plan to handle these"**),
2c big-picture compare (`/macro`: passage input beside auto-displayed genre
conventions; genre edits click-through + versioned), 2d style compare
(`/style`: Required features auto-listed, plan box per feature), 2e decisions
summary + first draft in text or voice (`s0.translation` + audio recorder).

## Key implementation facts

- **Stable node ids preserved throughout** — nothing orphaned. `s0.purpose`
  nests inside `s0.genre_choice`; `s1b.associations`/`s1b.vitality` moved into
  the `s2eth` group; `s1c.notes` moved into 2b; `s2e`/`s3g` (prose pointers)
  deleted. Content version 2.0.0.
- **Dexie v3**: `history` (entry version history) + `recordings` (audio blobs)
  stores; upgrade migrates old modality values `possible`/`expected` → `common`.
- **New synthesis-state nodes** (not in the content tree): `choose.shortlist` /
  `choose.locked` (focusText layer), `choose.flag` (per passage×genre worksheet,
  cell_key = factor node id), `style.idea` (cell_key = `tableId__rowId`).
- **Summary companion**: long genre answers (>15 words / >120 chars) get a
  `__summary` cell entry + non-blocking nudge; table/compare views show the
  summary, else a truncated answer with a needs-summary mark.
- **History**: `upsertEntryWithHistory` records prior values (restores are
  themselves recorded). Surfaced via `HistoryList` on the 2c/2d genre edits.
- **Redirects**: `SUB_PAGE_ROUTES` in the loader sends
  `/worksheet/s0.genre_choice|s0.macro_notes|s0.stylistic_notes` to
  `/choose|/macro|/style`.
- Old `/compare` page removed (superseded by 2b–2d).

## Decisions of record (2026-07-18)

Per-passage-only fit flags; two-way Required/Common scale (explainer text lives
in the content config for localization); non-blocking summary nudge; guard
lists warnings + unresolved questions; all legacy features kept and re-homed;
text + voice first draft; light many-to-many coverage panel; #18 relocated;
#15 trimmed ("about?" stays in 1b, fun/ceremony folded into purposes,
made-up-vs-planned joined stable/malleable); home chart + printable (`/chart`);
Workspace 2 named "Create / Translate", passage-generic; review in the built
app, no mockups.

## Status

Built on `feature/two-workspace-redesign` (stacked on
`feature/sidebar-responsive-density` → `feature/katie-feedback-2026-07-11`).
Gate: typecheck, lint, 32 tests, PWA build. Awaiting Josh & Katie's
click-through before any merge/deploy to main.
