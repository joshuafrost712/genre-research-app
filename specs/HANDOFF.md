# Handoff — Katie's feedback batch (implemented 2026-07-11/12, overnight)

Branch: **`feature/katie-feedback-2026-07-11`** (NOT merged, NOT pushed — nothing
auto-deployed to live users). Review, then merge to `main` when happy.

All 8 specs in this folder were written first, then implemented. Every one of
Katie's 28 comments is addressed except the two you asked me to leave for your
ruling (#15, #18 — see `07-open-pedagogical-decisions.md`).

## Verified

- `npm run build` — clean (tsc + vite).
- `npm run test` — 25/25 pass (added `tests/sectionRecall.test.ts`; updated two
  routing tests in `tests/core.test.ts`, see "Behavior changes" below).
- `npm run lint` — no new errors in any touched file. (One pre-existing error in
  `vite.config.ts` and 5 pre-existing provider warnings are untouched.)
- Content tree integrity check: Section 1 = 1A / 1B / **1C People and Things** /
  1D Matching; Section 2 = 2A–2E contiguous; `genre_choice.chosen` is a genre
  picker.
- Dev server boots and serves 200.

**Not driven in a real browser** (no Playwright here): the interactive pieces —
the 1A genre-bank inline editor, the genre dropdowns, the sticky sidebar, the
Section-3 recall panels, the translation summary. Please click through these.
Suggested smoke path: add a genre in 1A → check it appears on All Psalms &
Genres and in the "Which genre" dropdown; star a feature in 3A → open Psalm
Notes: Small Details and confirm it shows under "Words"; open Psalm Translation
and confirm the summary; on a worksheet, scroll the left menu independently.

## What changed, by comment cluster

- **Genre unification (#4, #2, #3, #1):** 1A "Genres you have found so far" is now
  the real genre list (new `genre_bank` block, add/rename, reads/writes the
  `genres` table). Genre-choice "Which genre" and the candidates "Genre" column
  are now pickers (`genre_select`) sourced from those genres; they store the
  genre **name** as text so exports/progress/summaries work unchanged. A one-time
  migration (`migrateInventoryGenres` in `appState.ts`) promotes any genres you'd
  already typed in the old 1A list into real genre records (dedup by name). The
  dangling "genre table (1B)" reference is fixed.
- **2A → 1B restructure (#13, #24):** the People-and-Things node (`s2eth`) moved
  into Section 1 as **1C**, keeping the "picture a real performance" prompt.
  Section 2 renumbered 2A–2E; "(prominence)" (#20) and "(connections)" (#21)
  added. Node ids are unchanged, so **no existing answers are lost**.
- **Cross-section reuse (#5, #22, #23):** each Psalm Notes: Small Details group
  now shows a read-only "What you noted" panel derived from its Section 3
  subsection (starred first), with a link back — so work isn't re-entered. The
  Psalm Translation page opens with a "What you have found so far" summary
  (purpose + chosen genre + starred priorities).
- **Navigation + layout (#6, #9, #10):** the left menu scrolls independently
  (app-shell layout); a "Home" quick link + a "← Home" link on the genres page.
- **Form fixes (#17, #26):** single-select options deselect on a second click;
  the priority star is reachable while a row is open.
- **Copy (#7, #8, #11, #12, #14, #16, #19, #25, #27, #28):** applied per
  `06-copy-and-labeling.md`; page renamed "All Psalms & Genres"; N/A → "Not
  applicable"; flag legend added; 1A prompts phrased as questions; etc.

## Behavior changes to be aware of (please sanity-check)

1. **The 1A genre list no longer accepts routed notes / AI placements.** Genres
   are entities now, created deliberately in 1A or on the genres page — which
   also matches your #3 concern (don't let people enter unresearched genres). The
   two `core.test.ts` routing tests that used `s1a.inventory` as a generic
   repeatable-list fixture were repointed to `s1a.whom` (still a list); coverage
   is preserved, not weakened. If you WANT dictation to create genres, that's a
   small follow-up (a `genre_bank` branch in `routeNoteToNode`).
2. **The 1A genre list dropped per-item delete + the follow-up flag**, to match
   the genres hub (add/rename only). The follow-up flag legend (#25) now lives on
   the other 1A lists (who/when/what to ask), which still have flags.

## Resolved spec open-questions (defaults I chose; change if you disagree)

- Genre unification model **A1** (1A is the genre bank) — per your "1A creates
  genres" decision.
- Restructure placement **A-ii** (People-and-Things as its own 1C).
- Cross-section reuse **B-i** (derive live, no snapshot copy).

## Deferred / follow-ups

- **#15, #18** — your pedagogical ruling (see spec 07). Untouched.
- **#22 richest form** — Katie's ideal was a dropdown of observations you star
  *in place*. Delivered: read-only recall + star/idea in the existing table +
  link. In-place star-from-source is a future refinement.
- Optional: let dictation create a genre (see behavior change #1).

The feedback batch file was moved to `feedback/processed/`.
