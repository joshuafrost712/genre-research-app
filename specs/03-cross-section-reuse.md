# Spec 03 — Auto-surface Section 3 work; running summaries

**Owns:** #5 (high), #22 (med), #23 (med).
**Priority:** High/Med.

## Goal

Work done once should appear where it's needed again. A team that researched
words in 3A (and starred priorities) should not re-type it in the stylistic-
notes step, and should see a running summary while drafting the translation.

## Current state (confirmed)

- **Section 3** feature tables (e.g. 3A `s3a.features`, "Special word features",
  `guide-content.json:1001-1036`, genre layer) are `repeatable_row_table`s with
  `priorityEligible:true`, `priorityMax:2`. Stars persist via `setRowPriority`
  (`src/lib/storage/entries.ts:232-240`) writing `is_priority:true` on the
  row-level Entry. The 3B–3F tables follow the same pattern.
- **`s0.stylistic_notes`** (`guide-content.json:300-446`, synthesis layer) has
  six tables — `s0.sn.words` "Words (from 3A)" (`:308-329`), `s0.sn.discourse`
  "(from 3B)", `s0.sn.sounds` "(from 3C)", `s0.sn.figurative` "(from 3D)",
  `s0.sn.performance` "(from 3E)", `s0.sn.additional` "(from 3F)". The "(from
  3X)" is **static label text**; these tables are empty and manually re-entered.
  No `xref`, no `rowSource`, no live binding.
- **`s0.translation.intro`** (`guide-content.json:455-458`) ends with "Let your
  notes above guide you." — no actual summary.
- A working derivation pattern already exists: `src/lib/content/compareSummary.ts`
  builds genre-side / psalm-side summaries from Entries (used by the Compare
  page). Reuse it; don't reinvent.

## Target behavior

- **#5 / #22:** Each `s0.sn.*` table shows the team's Section-3 observations for
  the active genre without re-entry. Katie's preferred solution (#22): a dropdown
  of the observations already made, from which the team stars the top two and
  writes how to retain each in this psalm's translation.
- **#23:** The translation page opens with a running summary of everything
  identified so far (purpose, chosen genre, starred stylistic priorities), so the
  team can reference it while drafting.

## Implementation notes

### A. Surface Section 3 in stylistic-notes (#5, #22)

Preferred design (matches #22): each `s0.sn.X` becomes a **pick-and-plan** block:

1. A read-only list / dropdown of the source section's observations for the
   active genre — e.g. `s0.sn.words` sources from `s3a.features` rows. Use the
   **unused `rowSource` schema field** (`src/schema/types.ts:101`) to declare the
   source node id, and a `useLiveQuery` reader (modeled on `compareSummary.ts`)
   to pull those rows.
2. The team stars the top two (reuse `priorityEligible`/`priorityMax:2` and
   `PriorityStar` already on these nodes).
3. An `idea` field per selected item ("Idea for translating it in this psalm") —
   the column already exists (`:322-327`).

Data model choice (confirm at review):
- **B-i (recommended):** keep the `s0.sn.*` `idea`/star as their own synthesis-
  layer Entries, but derive the *feature list* live from Section 3 (no copy). The
  synthesis layer stores only the psalm-specific plan + which source rows were
  chosen (store the source rowId as the `cell_key`/reference). This preserves the
  synthesis-vs-genre layer separation and means editing 3A later updates the
  choices here.
- **B-ii:** snapshot-copy 3A rows into `s0.sn.words` on first visit. Simpler read
  path but drifts when 3A changes; rejected unless B-i proves too invasive.

Render: extend `BlockRenderer.tsx` with a block variant that, given `rowSource`,
lists source rows (feature text) as selectable options, shows the star, and an
`idea` input per chosen row. Empty-source state: "No observations recorded in
{3A} yet — add them there first," with a nav link (an `xref` to the source
section, so it's also a hyperlink per #22's first idea).

Add `xref` to each `s0.sn.*` node → its source section, so even before/besides
the derived list there is a working hyperlink back to the work (Katie's #22
fallback options).

### B. Running summary on the translation page (#23)

Replace the trailing "Let your notes above guide you." (`s0.translation.intro`,
`:457`) with a **derived summary block** that shows, for the active
psalm+genre:
- the psalm purpose (`s0.purpose.*`),
- the chosen genre (`s0.genre_choice.chosen`),
- the starred stylistic priorities across `s0.sn.*` (feature + idea).

Build it from `compareSummary.ts` helpers (or a small sibling module) reading
Entries; render read-only above the draft field (`s0.translation.draft`). Keep
prose encouragement ("Keep prayer part of the work…") but move the "guide you"
sentence's job to the actual summary.

## Acceptance criteria

- Star a word feature in 3A → it is available (and shows as starred) in the
  stylistic-notes "Words" block without retyping; same for 3B–3F.
- Editing a 3A observation updates what appears in stylistic notes (B-i).
- Each stylistic-notes group links back to its source section.
- The translation page shows a live summary (purpose, chosen genre, starred
  priorities) above the draft box.
- `npm run build` clean; no data duplication that drifts.

## Open questions for review

- B-i (derive live) vs B-ii (snapshot) — recommend B-i.
- Exact fields to include in the translation summary (draft above).