# Spec 06 — Copy, titles, hyperlink, flag legend

**Owns:** #7, #8, #11, #12, #14, #16, #19, #20, #21, #25, #27, #28 (all med).
**Priority:** Medium. Mostly string edits; two touch behavior lightly (#11
hyperlink, #25 legend).

## Goal

Apply Katie's wording, titling, ESL, and clarity fixes. Each is a precise edit;
the table below is the source of truth. #20/#21 are coordinated with Spec 02's
renumber (edit the labels once, there).

## Edit table

| # | File / anchor | Current | Change to |
|---|---|---|---|
| 7 | `src/pages/GenreBank.tsx:109-112` | "…editing it updates everywhere." | "…editing it updates information about it everywhere." |
| 8 | `GenreBank.tsx:61` (h1) + `tours.ts:42` + NavShell label | "Your psalms & genres"; page lists Psalms then Genres; side menu says "Genres" | Rename to **"All Psalms & Genres"** everywhere it appears; make the order consistent across the side menu and the page (psalms-then-genres in both, matching the page). Update the tour title too. |
| 11 | `GenreBank.tsx:64-67` (intro paragraph) | "…Add the ones you want to study… Tap a genre to work on it." | Append: "If needed, you can begin the process of identifying local genres by using **Finding and Describing Local Art Forms**." Make that phrase a link to Section 1 (route of `s1a`, i.e. `/worksheet/s1a`). |
| 12 | `guide-content.json` `s1a.whom` (:498), `s1a.where` (:506), `s1a.questions` (:514) | "People to ask (…)", "When and where to ask (…)", "Questions to ask (…)" | Restate as questions, keeping the parenthetical examples: "Who could we ask about genres? (for example: leaders, teachers, artists, mothers)"; "When and where could we ask? (…)"; "What questions can we ask? (…)". |
| 14 | `guide-content.json` `s1b.associations:560` | "What does {genre} remind people of? (other art forms; religion, politics, or customs)" | Parenthetical → "(for example, a religious practice, a musical instrument, a type of dance, a certain topic, a particular kind of clothing, specific objects, politics, or customs)" |
| 16 | `BlockRenderer.tsx:205` (N/A button) + marked text `:210` ("Marked not applicable.") + help/tour copy (`Help.tsx:67`, `tours.ts:32,62`) | button label "N/A" | "Not applicable" (ESL-friendly). Global — verify it fits the button layout on mobile; if too wide, "Not applicable" is still preferred over "N/A" per Katie. Update help/tour text to match. |
| 19 | `guide-content.json` `s0.genre_choice` guidance `:84` | "…note any problem and an idea to handle it." | "…note the problems and ideas for how to handle them." (also see #1/Spec 02 for the "genre table (1B)" clause in the same guidance) |
| 20 | `guide-content.json` `s2a.label:744` | "2C: How {genre} Makes Things Stand Out" | Handled in **Spec 02** renumber → "2B: How {genre} Makes Things Stand Out (prominence)" |
| 21 | `guide-content.json` `s2d.label:864` | "2E: How {genre} Links Related Ideas" | Handled in **Spec 02** renumber → "2D: How {genre} Links Related Ideas (connections)" |
| 25 | `/worksheet/s1a` genre rows — the flag control | flag icon with no explanation | Add a short legend / tooltip explaining the flag. (See "What the flags are" below.) |
| 27 | `guide-content.json` `s2a.how:750` and any "most important part" in the `s2a` group | "…make its most important part stand out…" | "…make its most important idea(s) stand out…" — apply throughout the `s2a` section (check `s2a.secondary`, `s2a.climax`, `s2a.peak`, and the section's example strings for "part(s)"). |
| 28 | `guide-content.json` `s2a.how:750` (the "For example:" clause) | "For example: by where it is placed; by a repeated line (a refrain); by repeating words; by surprising the listener; by strong feeling; or by packing many strong features together." | "For example: by where it is placed; by repetition (a word, a line, a refrain, an antiphonal response); by a sudden change in volume or other voice feature; by a change in musical instrument; by packing many strong features together; by surprising the listener (explain how)." |

## What the flags are (#25)

The "flags" are the **follow-up / concern flags**. On the Genres page a genre
card shows "N follow-up flag(s)" counting Entries with `is_concern_flag`
(`GenreBank.tsx:97,200-204`); the per-field concern flag is set in
`BlockRenderer.tsx`. On the 1A list the same flag icon appears next to items. It
marks something to revisit/resolve later. Fix = a one-line legend near the flag
control and/or a tooltip: e.g. "Flag something to come back to." Confirm the
exact 1A rendering when implementing (the flag toggle in the repeatable-list row)
and place the legend where it's visible without clutter.

## Notes / coordination

- #20 and #21 are executed in Spec 02 (label renumber) to avoid editing the same
  strings twice; listed here for traceability only.
- #8 "consistent order": the page renders Psalms then Genres
  (`GenreBank.tsx:70-107`); make the side-menu ordering and the title match that
  (Katie proposed "All Psalms & Genres", i.e. psalms first). Check `NavShell`
  and `tours.ts` for the label/order.
- #16 is global (one button component); there is no purpose-specific N/A string.

## Acceptance criteria

- Every row above is applied at its anchor; strings match Katie's requested
  wording.
- The "Finding and Describing Local Art Forms" phrase is a working link to
  Section 1.
- The flag has a visible explanation on 1A.
- Title "All Psalms & Genres" and psalms-then-genres order are consistent across
  page, side menu, and tour.
- `npm run build` clean; no broken JSON (validate `guide-content.json`).
