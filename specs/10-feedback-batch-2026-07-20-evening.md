# Spec 10 — Katie's 2026-07-20 evening feedback batch (26 comments)

**Source:** in-app feedback batch exported 2026-07-20 21:45 UTC (26 comments:
3 high / 23 medium, collected the same day on the two-workspace redesign
build; file now in `feedback/processed/`). This was the first click-through of
the redesign itself, hours after spec 09 shipped. Implemented as ten work
packages on `feature/two-workspace-redesign`, one commit each (WP1–WP9) plus
this record.

Decisions of record (Josh, 2026-07-20): **#2 inline editing live-applies** to
`guide-content.json` (git diff is the review mechanism; every edit is also
recorded in the batch). Adopted defaults: **#14** trimmed per Katie now, with
relocation of the fixed-vs-malleable pedagogy kept as an open item; **#21**
hard cap of 3 kept genres; **#1** one merged "Describe a Genre" stage (the
side menu shows one 1b–1e group; nested sub-stages deferred); legacy stored
`other` purpose selections keep a readable label; vitality values migrate
weak→fading, neutral→stable, strong→thriving; old combined `s3b.speech`
answers stay under the reworded quote question.

## Disposition of all 26 items

WP1 — content tree (`guide-content.json` v2.2.0; rewords keep their node ids):
- **#4** W2 blurb → "Bring one passage to life in one of your community's
  genres." (in `loader.ts` `workspaces()`, WP2 commit)
- **#5** CLAT/Frost note moved out of the 1a bank footnote into a prose node
  (`s1a.sources`) after the prompts
- **#7 (content half)** `entertaining` added to `s1b.purpose_families`
- **#8** `s1b.purposes` reworded ("What function does it play? …")
- **#9** `s1b.other` ("Other notes about {genre}") deleted; old answers stay
  in the DB untouched (spec-09 practice)
- **#10** new `s2eth.other` "Other notes on {genre}" after the
  planned/spontaneous question (new id so orphaned 1b notes don't reappear)
- **#11** materials question → "What materials/objects do people use…"
- **#12** associations question gains "What associations do they have with
  it?"
- **#14** `s2eth.stable_malleable` trimmed to "Is {genre} planned ahead, or
  made up on the spot?" (guidance/example trimmed to match; id survives, so
  the /choose comb and old answers are unaffected)
- **#16** `s3b.characters` → "How are people named or referenced…"
- **#17/#18** (#18 supersedes #17) `s3b.speech` → "Describe the use of
  people's exact words (direct speech), and/or people's reported speech
  (indirect speech)."
- **#19** particles split out as new `s3b.particles`
- **#20** intended-use covers "translation / Scripture-inspired artistic
  creation"
- **#24** leftover `s1c.notes` ("Discussion notes: …") deleted

WP2 — **#1 (high)**: home Workspace-1 chart is Katie's three groups — Find
Genres (1a) / Describe a Genre (1b–1e) / Genre summary table (1f) — via the
JOURNEY array; `journeyOrder()` keeps the walk order identical so Wizard,
Next buttons, and progress are unchanged.

WP3 — **#13**: vitality is five buttons (Extinct / Locked / Fading / Stable /
Thriving) with rhetorically parallel definitions behind the same "What do
these mean?" toggle as Required/Common (`GuideNode.help`). Dexie v4 upgrade
remaps stored values; `Genre.vitality_rating` union updated. Test:
`tests/vitalityMigration.test.ts`.

WP4 — **#6**: 1a add-genre box sits above the list; sort control A→Z
(default) / Z→A / Most described (by `genreProgress` answered-count),
persisted per project (`meta bankSort:`).

WP5 — **#7 (feature half)**: "+ Other…" on the purpose families adds a custom
purpose (project-wide, `meta customOptions:`, `lib/customOptions.ts`), which
flows into the 1f coverage panel and /choose purpose chips. Tests:
`tests/customOptions.test.ts`.

WP6 — **#15**: filled feature-table chips show the chosen value — "Required"
(dark emerald) vs "Common" (sky) — instead of "Part of the genre".

WP7 — /choose (`ChooseGenre.tsx` + `lib/chooseShortlist.ts`):
- **#21** keep/set-aside is a tri-state (kept / explicitly set aside /
  undecided; new `choose.setAside` entry). "Bring back" appears only on
  genres someone set aside; undecided rows say "Keep". Hard cap of 3 with a
  set-one-aside hint and a "Set the rest aside" shortcut. Existing passages:
  previously-hidden genres reappear as undecided (they were never explicitly
  set aside). Tests: `tests/chooseShortlist.test.ts`.
- **#22** step-4 flag badge red (`text-red-300` on gray-800), not gold
- **#23** legend + flag tooltip state tap counts (1/2/3 taps, 4th clears)
- **#25** candidate rows auto-seed from kept genres, once per genre per
  passage (`choose.seededCandidates` marker; StrictMode-safe single-flight);
  a deleted seeded row stays deleted
- **#26** section retitled "Note Taking Space for Considering Genres"

WP8 — **#3 (high)**: new `passage_bank` block (`s0.setup.passages`) embeds
add / switch ("Focus on this") / rename of passages directly in 2a; switching
re-scopes all of Workspace 2. The context-bar picker remains.

WP9 — **#2 (high)**: edit-in-place for worksheet text in dev mode. Rendered
guide-content strings carry `data-dfb-node`/`data-dfb-field`; selecting one
offers "✎ Edit text", which edits the TEMPLATE (tokens intact, rendered
preview, confirm on token removal) and live-applies via the dev-only
`/__content-edit` endpoint (oldText must match — 409 on stale; only
label/guidance/footnote/example/help; never bumps the content version).
Every edit is recorded in the batch ("Text edits" section, schema v2);
offline/deployed edits save as pending suggestions. Endpoint verified:
apply / 409 / 400 / 404 / byte-identical revert.

## Deferred (recorded, not built this round)

- Passage delete in 2a (no `deleteFocusText` cascade exists yet).
- Custom-purpose delete UI, and export/sync of custom purposes (they live in
  `meta`, outside the entries outbox).
- Edit-in-place for option labels and table-column labels (phase 2 of WP9;
  plain comments still cover them).
- Nested sub-stages in the side menu if the single 1b–1e group feels long.
- Relocating the "which parts must stay the same" (fixed-vs-malleable)
  question — trimmed from 1c per Katie; its pedagogy ("where a translation
  has room to move") may deserve a home in the 1e intro. Open pedagogical
  item, spec-07 style.

## Verification

`npm run build` (tsc + PWA) clean; vitest 51/51 across 10 files (new:
vitalityMigration, customOptions, chooseShortlist); `/__content-edit`
exercised end-to-end with curl (apply, stale-409, bad-field-400, unknown-404,
clean revert). Manual click-through checklist for Josh & Katie:

1. Home: three W1 rows, new W2 blurb, Continue walks s1a → … → s3f → 1f.
2. 1a: sources note after the prompts; add box on top; three sorts persist.
3. 1b: reworded purposes prompt; Entertaining chip; "+ Other…" adds a custom
   purpose; no "Other notes" box.
4. 1c: materials/associations rewords; planned-vs-spontaneous only; new
   "Other notes on {genre}" box; five vitality buttons + "What do these
   mean?"; a pre-redesign answer of Fading/Steady/Strong shows the mapped
   new label.
5. 1e.1: Required (dark emerald) vs Common (sky) chips on saved rows.
6. 1e.2: rewords + separate particles question; an old combined answer still
   shows under the speech question.
7. 1f: coverage panel includes custom purposes.
8. 2a: passage list add/switch/rename inline; heading re-renders "2a: Focus
   on ⟨passage⟩"; 2b–2e re-scope.
9. /choose: Keep → cap at 3 → Set aside → Bring back; red flag count; tap
   legend; seeded candidate rows; retitled notes; no discussion-notes box.
10. Dev feedback: comment still works; "Edit text" round-trips (text changes
    on screen, `git diff src/content/guide-content.json` shows one field);
    token-removal confirm; batch markdown gains the "Text edits" section.
