# Spec 02 — Fold 2A anthropology into 1B; renumber Section 2

**Owns:** #13 (med), #24 (med), #1 (high, shared with Spec 01).
**Priority:** High/Med. **Locked decision:** move 2A → 1B.

## Goal

The "who performs it, when, and what they use" anthropology (currently Section
2A) helps decide whether a genre is even usable, so it should sit with the basic
genre facts in Section 1B, not two steps later (Katie #13). Keep the vivid
"picture a real performance" prompt (#24).

## Current state (confirmed)

- **1B `s1b`** ("About This Genre", `guide-content.json:522-592`), genre layer.
  Children: intro, name_meaning, content, associations, vitality, other. Its
  guidance (`:526`) and intro (`:532`) both say the performance details "come in
  Section 2" and link to `s2eth`.
- **2A `s2eth`** ("The People and Things", `guide-content.json:623-679`), genre
  layer. Guidance (`:627`) = the "picture a real performance" prompt (#24).
  Fields: `who`, `roles`, `when`, `materials`, `space`, `stable_malleable`.
- **`JOURNEY`** (`src/lib/content/loader.ts:175-206`) drives ordering. Step 3
  `bigpicture` lists `['s2eth','s2b','s2a','s2c','s2d','s2e']`. Display labels:
  s2eth=2A, s2b=2B, s2a=2C, s2c=2D, s2d=2E, s2e=2F.

## Target behavior

- The People-and-Things fields live in Section 1, adjacent to the other genre
  basics, so a team judges suitability before deep study.
- The "picture a real performance" guidance is preserved verbatim.
- Section 2 no longer has a "2A"; its subsections renumber cleanly.
- No genre-layer answers are lost.

## Implementation notes

### Data-safety principle

Entry rows are keyed by **`node_id` (+ `cell_key`) and `genre_id`**, not by tree
position or display label. **Moving `s2eth` (and its children, keeping their
ids) to a new place in the tree and in `JOURNEY` preserves every existing
answer.** Renumbering only touches `label` strings, never ids. Do **not** rename
node ids.

### A. Relocate the node

Recommended placement: keep `s1b` "About This Genre" for the basic facts, and
place the People-and-Things group as its own subsection **inside Section 1**,
immediately after `s1b`. Because Section 1 already has `1C` (`s1c`, "Matching
the Psalm to a Genre", `guide-content.json:594-614`), inserting a
People-and-Things subsection means renumbering within Section 1 as well.

Two placement options — **confirm at review; recommend A-ii**:

- **A-i:** Merge `s2eth`'s six children directly into `s1b.children` (one longer
  1B page). Fewest nodes; but 1B becomes long, and the nice "picture a real
  performance" framing wants its own heading.
- **A-ii (recommended):** Move the `s2eth` group under Section 1 as a distinct
  subsection titled e.g. **"1B: The People and Things"**, and renumber the
  existing Section-1 subsections: current 1B "About This Genre" → keep as 1B's
  sibling. Concretely, a clean Section-1 order:
  - 1A Finding Local Genres (`s1a`)
  - 1B About This Genre (`s1b`)
  - 1C The People and Things (`s2eth`, moved) — carries the "picture a real
    performance" guidance
  - 1D Matching the Psalm to a Genre (`s1c`)

  This keeps ids stable (`s2eth`, `s1c` unchanged) and only edits labels +
  `JOURNEY`.

Update `JOURNEY` (`loader.ts:186,192`): move `'s2eth'` from the `bigpicture`
stage's `subIds` into the `find` stage after `'s1b'`. Result:
`find.subIds = ['s1a','s1b','s2eth','s1c']`;
`bigpicture.subIds = ['s2b','s2a','s2c','s2d','s2e']`.

### B. Renumber Section 2 labels

With `s2eth` gone from Section 2, edit only the display label prefixes in
`guide-content.json`:

| id | old label | new label |
|---|---|---|
| `s2b` | 2B: The Parts (Sections) of {genre} | **2A**: The Parts (Sections) of {genre} |
| `s2a` | 2C: How {genre} Makes Things Stand Out | **2B**: How {genre} Makes Things Stand Out **(prominence)** ← #20 |
| `s2c` | 2D: How {genre} Shows Feelings (Emotions) | **2C**: … (Emotions) |
| `s2d` | 2E: How {genre} Links Related Ideas | **2D**: … **(connections)** ← #21 |
| `s2e` | 2F (performance) | **2E** (performance) |

The `(prominence)` (#20) and `(connections)` (#21) additions ride along here so
labels are edited once. Spec 06 defers these two rows to this table.

Check for any other display-number references to update: the top-level Section 1
label ("Section 1: Finding and Describing Local Art Forms",
`guide-content.json:473`) and Section 2 label ("Section 2: The Big-Picture Shape
of {genre}", `:620`) stay. Search the codebase and content for hardcoded "2A"/"2C"
etc. strings (tours, help, prose cross-references) and reconcile — e.g. the
`s0.macro_notes.prominence` xref label "see 2A" (`guide-content.json:154`) points
at `s2a`, which becomes 2B; update the label text to "see 2B".

### C. Rewrite 1B guidance/intro that points to Section 2

- `s1b` guidance (`:526`): drop "You describe who performs it, when, and what
  they use in Section 2." Replace with a lead-in to the now-adjacent People-and-
  Things subsection.
- `s1b.intro` (`:532`) + its xref to `s2eth` (`:533-538`): reword; the target is
  now the next subsection in Section 1, not Section 2.

### D. #1 sliver (the "genre table you filled in (1B)")

The genre-choice guidance "Look at the genre table you filled in (1B)"
(`guide-content.json:84`) and the dangling `s1b.inventory` xref (`:95`) are
resolved together with Spec 01: after unification the genre list is real, and 1B
holds the genre facts. Reword the guidance to point at the identified-genres
list (Spec 01) rather than a nonexistent "genre table," and repoint the xref.

## Acceptance criteria

- The People-and-Things prompts appear in Section 1 (before deep study), with
  the "picture a real performance" guidance intact.
- Section 2 shows a contiguous 2A…2E with no gap; `(prominence)` on the
  Makes-Things-Stand-Out page and `(connections)` on the Links-Related-Ideas
  page.
- Existing genre-layer answers for `s2eth.*` still render on the moved
  subsection (verify by seeding an entry before the move).
- No stale "2A"/"2C"/"Section 2" references remain in prose, xref labels, tours,
  or help.
- `npm run build` clean.

## Open questions for review

- Placement A-i vs A-ii (recommend A-ii: `s2eth` as its own Section-1 subsection).
- Final subsection numbering within Section 1 (draft above).
- #15's fun/ceremony field (`s1b.content`) sits in 1B but is deferred to Spec 07;
  do not change it here.