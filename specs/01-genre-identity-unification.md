# Spec 01 — Genre identity unification

**Owns:** #4 (high), #2 (high), #3 (high), #1 (high, shared with Spec 02).
**Priority:** High. This is the most architectural spec and unblocks the others.

## Goal

Make "the genres a team has identified" a single, real list that every part of
the app reads and writes. Today there are two disconnected stores, so genres
typed in 1A vanish, and the genre-choice fields can't offer a dropdown.

## Root cause (confirmed in code)

Two separate stores hold "genres":

1. **1A "Genres you have found so far"** (`s1a.inventory`,
   `guide-content.json:488-494`) is a `repeatable_list` on the **focusText**
   layer. Each item is an `Entry` row (`node_id:"s1a.inventory"`,
   `cell_key:<rowId>`, `focus_text_id` set) in the `entries` table. It never
   touches the `genres` table.
2. **The Genres page** (`src/pages/GenreBank.tsx:39-42`) and every genre-scoped
   worksheet read the **`genres` entity table** (`src/lib/storage/db.ts`, type at
   `src/lib/types.ts:38-47`). Rows there are created only by `createGenre`
   (`src/lib/storage/appState.ts:190`), whose sole caller is the "Add genre" box
   on the Genres page (`GenreBank.tsx:103-106`) — plus the auto "Untitled genre"
   from `ensureActiveGenre` (`appState.ts:141-164`).

Nothing bridges (1)→(2). Hence #4 (1A genres missing on /genres), and #2/#3
(no dropdown source exists — `SingleSelect` in
`src/components/blocks/BlockRenderer.tsx:265-285` only renders static
`node.options`).

## Target behavior

- Adding an item in 1A "Genres you have found so far" creates a real `Genre`
  record in the project; it appears on the Genres page immediately and is
  offered wherever genres are selectable.
- Renaming a 1A item renames the genre; the same genre shown on /genres updates
  (the "editing updates everywhere" promise, cf. #7).
- The genre-choice fields become genre-pickers, not free text:
  - `s0.genre_choice.candidates.name` (`guide-content.json:100-106`) — pick from
    identified genres.
  - `s0.genre_choice.chosen` (`guide-content.json:127-133`) — pick from
    identified genres. Katie's #3 concern: free text lets people invent an
    unresearched genre; a picker prevents that.
- The dangling xref `s1b.inventory` (`guide-content.json:95`) is fixed — 1B has
  no `inventory` node. Point it at the real genre list (see Spec 02, since 1B is
  being restructured) or at the Genres page.

## Implementation notes

### A. 1A list ⇄ genres table

Two viable models; **recommend A1** for the smallest surface and because the
"single source of truth" decision points at it.

- **A1 (recommended): make the 1A inventory render the genre bank directly.**
  Give `s1a.inventory` a new block type (e.g. `genre_bank_list`) whose add /
  rename / (soft) remove call `createGenre` / `renameGenre` / a new
  `archiveGenre` in `appState.ts`, and whose items come from
  `db.genres.where('project_id').equals(...)`. This reuses the exact CRUD the
  Genres page already uses (`GenreBank.tsx:103-106`, `renameGenre`) so 1A and
  /genres are literally the same list. The list is project-scoped, not
  focusText-scoped — which is correct, since genres are reused across psalms
  (`GenreBank.tsx:109-112`).
- **A2 (alternative): keep `s1a.inventory` as Entry rows and sync.** On add /
  rename, upsert a matching `Genre` row (match by normalized name). More moving
  parts, risk of drift, and needs a migration for existing Entry-based 1A data.
  Only choose this if we must preserve 1A as focusText-scoped brainstorming.

Migration (either model): one-time import of existing `s1a.inventory` Entry rows
into `genres` (dedupe by trimmed, case-insensitive name). Guard so it runs once.

De-duplication + `ensureActiveGenre`: today `ensureActiveGenre`
(`appState.ts:141-164`) can auto-create an "Untitled genre". After unification,
suppress or fold that when the 1A list already yields genres, so users don't see
a stray "Untitled genre" beside their real ones. Define delete as **archive**
(soft) if any Entry data references the genre, to avoid orphaning genre-layer
answers keyed by `genre_id`.

### B. Genre-picker block for genre-choice

Prefer the **existing unused `rowSource` schema field** (`src/schema/types.ts:101`)
over inventing a new mechanism — it was designed to let a grid/select pull rows
from another node's list.

- Add a `genre_select` cell/block type (or extend `single_select`) in
  `BlockRenderer.tsx` that, when `rowSource` (or a new `optionsSource:"genres"`)
  is set, builds its options from `db.genres` for the active project instead of
  static `node.options`. Read live via `useLiveQuery` so newly added genres
  appear without reload.
- Wire it into `s0.genre_choice.candidates.name` and `s0.genre_choice.chosen`
  in `guide-content.json`. Keep an "add a new genre" escape hatch in the picker
  (creating one via `createGenre`) so the picker never becomes a dead end — but
  the default is choosing from researched genres (Katie's #3).
- For the `candidates` table, consider `rowSource` seeding the rows from the
  genre list so the table pre-lists identified genres (each with why / concerns
  / strategy columns) rather than starting empty. Confirm at review — this
  overlaps with #22's "pre-populate" theme in Spec 03.

### C. Fix the reference (#1 sliver)

`guide-content.json:93-98` xref `to:"s1b.inventory"` is dangling. After Spec 02
restructures 1B, repoint it to the genre list / Genres page and update the label
(the guidance text "genre table you filled in (1B)" is handled in Spec 02, since
1B's content is changing).

## Acceptance criteria

- Type a genre in 1A → it appears on `/genres` and in the genre-choice pickers
  with no reload.
- Rename it in 1A → the name updates on `/genres` (and vice versa).
- Genre-choice "Which genre" and candidate "Genre" are pickers sourced from
  identified genres, with an explicit add-new path.
- No stray "Untitled genre" appears once the user has real genres.
- Existing projects' 1A entries are imported once; no genre-layer answers are
  orphaned.
- `npm run build` clean; no dangling xref warnings for `s1b.inventory`.

## Open questions for review

- A1 vs A2 (recommend A1).
- Should the `candidates` table auto-seed one row per identified genre
  (coordinate with Spec 03 #22)?
- Delete semantics: hard-delete only when no dependent entries, else archive —
  confirm.