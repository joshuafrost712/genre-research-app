# Spec 05 — Deselect single-select; star the open row

**Owns:** #17 (med), #26 (med).
**Priority:** Medium. Small, self-contained fixes in `BlockRenderer.tsx`.

## Goal

Two friction points reported while filling forms:
- A team picked a "what kind of psalm" option, then realized they didn't know —
  and couldn't unpick it (#17).
- A team can't star the last / currently-open repeating row without first adding
  another row (#26).

## Current state (confirmed)

- **`SingleSelect`** (`src/components/blocks/BlockRenderer.tsx:265-285`): `onClick`
  always `upsertEntry(..., { value: o.id })` (`:273`) — never toggles off. Used
  by `s0.purpose.broad_genre` ("What kind of psalm is it?",
  `guide-content.json:33-35`) and `s1b.vitality`. `MultiSelect` (`:287-312`)
  already toggles (`:290-293`) and has no "at least one" rule; the "forced to
  pick" feeling is specific to single-select.
- **`PriorityStar`** (`BlockRenderer.tsx:711-734`) is rendered only in the
  collapsed `RowSummary` (`:488-490`), **not** in the open `RowEditor`
  (`:585-631`). A freshly-added row opens straight into the editor
  (`addAndOpen`, `:383-386`), so its star is unreachable until it collapses —
  which currently happens only when another row is added or "Done" is pressed
  (`RowEditor` header Done → `onClose`, `:611-613`). This is 3A's "Special word
  features" table (`s3a.features`) and any `priorityEligible` table.

## Target behavior

- Clicking an already-selected single-select option clears it (toggle off), so a
  team can back out of a guess. No option is mandatory.
- The priority star is reachable for the row a team is working on, without adding
  a throwaway row.

## Implementation notes

### A. Single-select deselect (#17)

In `SingleSelect` (`BlockRenderer.tsx:265-285`), change the click handler so that
when the clicked option equals the current `entry?.value`, it clears the entry
(write an empty/cleared value the same way a never-answered field reads, or a
dedicated clear path) instead of re-writing the same id. Mirror how `MultiSelect`
toggles (`:290-293`). Ensure "cleared" is distinguishable from "never answered"
only insofar as progress counting expects — check `src/lib/progress.ts` so a
cleared single-select doesn't count as answered. Apply to all single-selects
(it's generic); confirm `s1b.vitality` still behaves sensibly.

### B. Star the open row (#26)

Preferred: render `PriorityStar` in the `RowEditor` header
(`BlockRenderer.tsx:585-631`, near the Done button `:611-613`) when the table is
`priorityEligible`, so a team can star while the row is open. Keep it in
`RowSummary` too. Reuse the existing `PriorityStar` component and
`setRowPriority` — no new persistence.
Alternative (also acceptable): make "Done" the obvious close affordance and add a
one-line hint; but showing the star in the editor is the direct fix Katie asked
for ("close out the last entry without adding another row").

Respect `priorityMax` (2): the star component should already enforce/advise the
cap; verify the hint at `:416-418` still reads correctly.

## Acceptance criteria

- Clicking the selected "What kind of psalm is it?" option a second time
  deselects it; the field returns to unanswered and progress reflects that.
- In 3A, a team can star the row they just added while it is still open, without
  adding another row; the cap of 2 still holds.
- `npm run build` clean.
