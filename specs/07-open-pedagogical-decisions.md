# Spec 07 — Open pedagogical decisions (Josh to rule)

**Owns:** #15 (med), #18 (med).
**Priority:** Medium. **No code changes until Josh decides** — these are
methodology calls, not UI bugs.

## Why these are separate

Katie is questioning whether two prompts belong, not asking for a mechanical
fix. The right owner is Josh (CLAT / OBT methodology). This spec records the
options and ripple so a decision is quick; nothing is changed pre-decision.

## #15 — The "fun or ceremony / made up or planned" questions

- **Where:** `guide-content.json` `s1b.content:552` — "What is {genre} about? Is
  it for fun or for ceremony? Is it made up on the spot or planned ahead?"
- **Katie:** "I don't understand the purpose of this series of questions."
- **Read of intent:** these three sub-questions (topic; register/occasion;
  improvised vs fixed) probe suitability and how much a translation can vary. The
  "made up vs planned ahead" idea also recurs in `s2eth.stable_malleable`
  (`:675`).
- **Options:**
  - **Keep + clarify:** add a one-line "why we ask" (these shape whether the
    genre fits a psalm and how freely wording can change). Lowest disruption.
  - **Split:** separate the three questions into their own fields so each is
    clearly purposeful.
  - **Move/trim:** fold "made up vs planned" into `s2eth.stable_malleable`
    (which, post-Spec-02, sits nearby in Section 1) and keep only "what is it
    about?" in `s1b.content`.
  - **Cut:** remove the sub-questions if they're not earning their place.

## #18 — The skopos-level "how will people use this translation" question

- **Where:** `guide-content.json` `s0.purpose.intended_use:70-74` — "How will
  people use this translation? Will they sing it, listen to it, read it, or join
  in? Where will they use it? (Example: sung together in church.)"
- **Katie:** "This seems like a skopos-level question. How does it fit into this
  specific process?"
- **Read of intent:** intended use (skopos) legitimately informs genre choice and
  performance decisions, but it may belong to a prior project-level brief rather
  than this per-psalm worksheet.
- **Options:**
  - **Keep + frame:** add a line tying intended use to the genre/performance
    choices it informs later.
  - **Relocate:** move it to a project/setup context (once one exists) instead of
    per-psalm Section 0.
  - **Cut:** drop it if skopos is handled elsewhere in the team's process.

## Action

Leave both prompts exactly as they are until Josh rules. When he picks, the edits
are small `guide-content.json` changes (and possibly a `JOURNEY`/placement tweak
for #18 relocation) — fold them into the copy pass (Spec 06) or restructure
(Spec 02) as appropriate.
