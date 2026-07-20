# Spec 09 — Katie's 2026-07-17 feedback batch, applied to the redesign (2026-07-20)

**Source:** in-app feedback batch exported 2026-07-20 (22 comments, collected
2026-07-17 on the pre-redesign build; file now in `feedback/processed/`).
Because the batch predates the two-workspace redesign by one day, about half
of it was already delivered by the redesign itself. Josh's decisions of record
on the two divergences (2026-07-20): keep the redesign's summary-box mechanic
(the threshold nudge, not the always-visible paired boxes of #20/#22), and
adopt Katie's names.

## Disposition of all 22 items

Already resolved by the two-workspace redesign (no code change this round):
- **#1** genre summary table → `/summary` (1f)
- **#5** old 1D prompt box → page dissolved into 2b
- **#11/#16** 1b reworded around topics + purposes
- **#13** switch passage → context-bar switcher; `/compare` gone
- **#17/#21** 1c = social factors; associations + vitality moved in
- **#20/#22 (mechanic)** summary-for-table → the `__summary` companion + nudge
  (kept over the 150-char paired-box spec, per Josh 2026-07-20)

Applied this round:
- **#8** `s2eth.who` label trimmed ("…and who is it for?" removed)
- **#9** who-question guidance reworded (ages / genders / status / roles;
  "audience" not "listeners")
- **#10** `s2eth.roles` removed from the content tree AND from the 2b comb's
  FACTORS. Old answers stay in the DB untouched (nothing prunes entries for
  removed nodes).
- **#20/#22 (names)** 1b → "Genre Purpose"; 1c → "Social Features of {genre}".
  1b keeps its extra prompts (description, purpose families) — they feed the
  coverage panel and chooser funnel — so "just two questions" was deliberately
  not applied.
- **#19** 2a → "Focus on {passage}" via a new `{passage}` label token
  (GenreNameProvider now resolves `{genre}` + `{passage}`; falls back to
  "your passage" while untitled).
- **#2** 2b comb cells now expose the thorough discussion: a "Read the full
  note" button opens a modal with the full text + an "Edit in Workspace 1"
  link (`fullAnswerBehindCell` in summarize.ts).
- **#18** 2b intro always states the Workspace-1 prerequisite with a link to
  1a (was only in the empty-bank state).
- **#7** each 1a bank row has "Describe this genre →" (sets active genre,
  jumps to 1b).
- **#12** genre-list integrity (`src/lib/genreNames.ts` + appState):
  - unique names enforced on add AND rename (exact match blocked with an
    explanatory popup)
  - near-duplicate detection (Levenshtein; short names must match exactly) on
    add, with a same/different/edit choice
  - a possible-duplicates banner over the bank for doubles already in the
    list, offering merge (per-pair dismissible, persisted in meta
    `dupDismiss:` keys)
  - `deleteGenre` (confirmed, explains the cascade: genre answers, worksheets,
    flags, recordings) and `mergeGenres` (non-conflicting answers move to the
    survivor; on conflict the survivor's answer wins)
- **#3/#4** duplicate genres explained: concurrent `ensureActiveContext` runs
  (React StrictMode double-effect) both created starters / re-ran the
  inventory migration. Now single-flight guarded. Existing duplicates in
  user data surface through the #12 merge banner rather than any silent
  cleanup.
- **#14/#15** all multiline boxes (AutosaveText) auto-grow with content, and
  empty boxes reserve enough rows for their placeholder text.
- **#6** worksheet tour now says the ⚑ flag is the follow-up mechanism and
  where flagged items gather.

## Verification

39 vitest tests (7 new in `tests/genreIntegrity.test.ts`: name matching,
delete cascade, merge semantics, race guard), tsc, eslint (pre-existing
warnings only), PWA build, plus a 20-check Playwright drive of the running
app (dup popups, merge, delete, describe jump, renames, wording, autogrow,
full-note modal, prerequisite note, race guard).

## Still open for Josh & Katie

- The first-run "Untitled genre" / "Untitled focus text" starter rows (spec 08
  review item) — now partly mitigated: the delete button can remove a starter
  genre, but one is re-created when a project has none.
