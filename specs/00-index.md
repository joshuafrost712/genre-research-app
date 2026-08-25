# Spec index — Katie's feedback batch (2026-07-11)

Source batch: `feedback/incoming/feedback-2026-07-11T22-09-10-653Z.md`
(28 comments · 6 high · 22 medium · 0 low).

These specs are the consolidated response to that batch, produced per
`feedback/README.md`: read every item, cluster by shared root cause, one plan
grouped by pattern. Each spec below owns a cluster. Implement after review, then
move the batch file `incoming/ → processed/`.

## Locked decisions (Josh, 2026-07-11)

1. **2A → 1B.** Fold the Section 2A "People and Things" anthropology fields into
   Section 1B; renumber the rest of Section 2; keep the "picture a real
   performance" prompt verbatim (#24). → Spec 02.
2. **1A creates genres.** The 1A "Genres you have found so far" list becomes the
   single source of truth for genre entities; they flow to the Genres page and to
   dropdowns. → Spec 01.
3. **#15 / #18 are open pedagogical decisions** for Josh; no wording changes
   until he rules. → Spec 07.
4. **Output** = this `specs/` folder: index + one spec per theme.

## Specs

| Spec | Theme | Owns comments | Priority |
|---|---|---|---|
| [01](01-genre-identity-unification.md) | Genre identity unification (1A ↔ genres ↔ dropdowns) | 1, 2, 3, 4 | High |
| [02](02-section1-2-restructure.md) | Fold 2A anthropology into 1B; renumber Section 2 | 1, 13, 24 | High/Med |
| [03](03-cross-section-reuse.md) | Auto-surface Section 3 work; running summaries | 5, 22, 23 | High/Med |
| [04](04-navigation-and-layout.md) | Home/Start affordance; sticky sidebar | 6, 9, 10 | High/Med |
| [05](05-form-interactions.md) | Deselect single-select; star the open row | 17, 26 | Medium |
| [06](06-copy-and-labeling.md) | Copy, titles, hyperlink, flag legend | 7, 8, 11, 12, 14, 16, 19, 20, 21, 25, 27, 28 | Medium |
| [07](07-open-pedagogical-decisions.md) | "Why is this here" prompts — Josh to rule | 15, 18 | Medium |

## Specs added since this batch

This folder outgrew the batch it was created for. Later specs are listed here so
they are findable; they belong to their own requests, not to Katie's 28 comments.

| Spec | Theme | Source | State |
|---|---|---|---|
| [08](08-two-workspace-redesign.md) | Two-workspace redesign | Josh, 2026-07-20 | Shipped |
| [09](09-feedback-batch-2026-07-20.md) | Feedback batch, 2026-07-20 | In-app feedback | Shipped |
| [10](10-feedback-batch-2026-07-20-evening.md) | Feedback batch, same day, evening | In-app feedback | Shipped |
| [11](11-title-single-source.md) | Single-source-of-truth titles | Follow-up to 10 | Shipped |
| [12](12-team-presence.md) | Live team presence on the section tabs | Joshua, 2026-08-25 | **Specced, not built** |

## Full comment → spec traceability (all 28)

| # | Imp | Route | Gist | Owning spec |
|---|---|---|---|---|
| 1 | high | /worksheet/s0.genre_choice | "genre table (1B)" doesn't exist; surface genre info | 02 (primary), 01 (ref/dropdown) |
| 2 | high | /worksheet/s0.genre_choice | "Which genre" should be a dropdown of identified genres | 01 |
| 3 | high | /worksheet/s0.genre_choice | Candidate genre slot should be a dropdown | 01 |
| 4 | high | /genres | Genres added in 1A don't appear here | 01 |
| 5 | high | /worksheet/s0.stylistic_notes | Section 3 work should auto-appear (all of Section 3) | 03 |
| 6 | high | /worksheet/s2a | Side menu should scroll independently | 04 |
| 7 | med | /genres | reword "editing it updates information about it everywhere." | 06 |
| 8 | med | /genres | Rename page "All Psalms & Genres"; consistent order | 06 |
| 9 | med | /genres | Provide a way back to home | 04 |
| 10 | med | / | Start button / easy way back to home | 04 |
| 11 | med | /genres | Add hyperlink to "Finding and Describing Local Art Forms" | 06 |
| 12 | med | /worksheet/s1a | State the categories as questions (keep examples) | 06 |
| 13 | med | /worksheet/s1b | Anthropology (Section 2) belongs with suitability — include in 1B | 02 |
| 14 | med | /worksheet/s1b | Rephrase the associations parenthetical | 06 |
| 15 | med | /worksheet/s1b | Purpose of the fun/ceremony questions unclear | 07 |
| 16 | med | /worksheet/s0.purpose | "N/A" → "Not applicable" / "does not apply" | 06 |
| 17 | med | /worksheet/s0.purpose | Allow deselecting a single-select choice | 05 |
| 18 | med | /worksheet/s0.purpose | Skopos-level use question — does it belong here? | 07 |
| 19 | med | /worksheet/s0.genre_choice | Pluralize "problems and ideas for how to handle them" | 06 |
| 20 | med | /worksheet/s2a | Add "(prominence)" to the 2C title | 06 (coord. 02) |
| 21 | med | /worksheet/s2d | Add "(connections)" to the 2E title | 06 (coord. 02) |
| 22 | med | /worksheet/s0.stylistic_notes | Cross-refs as dropdown of observations + star top 2 | 03 |
| 23 | med | /worksheet/s0.translation | Offer a running summary while drafting | 03 |
| 24 | med | /worksheet/s2eth | Keep "picture a real performance" prompt if 2A moves | 02 |
| 25 | med | /worksheet/s1a | What are the flags next to the genres? | 06 |
| 26 | med | /worksheet/s3a | Star the last entry without adding a row | 05 |
| 27 | med | /worksheet/s2a | "most important part" → "most important idea(s)" throughout 2C | 06 |
| 28 | med | /worksheet/s2a | Reword the prominence "For example" list | 06 |

Every id in the batch's `Raw records` block maps to exactly one owning spec
above (cross-references noted in parentheses).

## A note on section numbering

Route ids do **not** equal display numbers. In `guide-content.json`, the current
Section 2 order (from the `JOURNEY` in `src/lib/content/loader.ts:175-206`) and
its display labels are:

| id | current label |
|---|---|
| `s2eth` | 2A: The People and Things |
| `s2b` | 2B: The Parts (Sections) |
| `s2a` | 2C: How … Makes Things Stand Out |
| `s2c` | 2D: How … Shows Feelings (Emotions) |
| `s2d` | 2E: How … Links Related Ideas |
| `s2e` | 2F (performance) |

Spec 02 moves `s2eth` out of Section 2, which renumbers the display labels
(2B→2A, 2C→2B, 2D→2C, 2E→2D, 2F→2E). Comments #20 and #21 target the labels
"2C" (`s2a`) and "2E" (`s2d`); after the renumber those become "2B" and "2D".
Spec 06 references the nodes by **id** and defers the final label text to Spec
02's renumber so the two stay consistent.