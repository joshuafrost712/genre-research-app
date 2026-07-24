# App intent — the north star for triaging feedback

This file states what the Local Genres Research app is *for* and how it is *meant
to work*, so incoming feedback can be judged consistently against the design
rather than re-argued from scratch each batch. When a comment asks for something,
the question is: does it move the app toward this intended function, or away from
it (or is it orthogonal polish)?

Keep this file current when the design genuinely changes; treat it as the
reference, not as immovable. Primary sources: `specs/08-two-workspace-redesign.md`,
the vault's `Genre App — Two-Workspace Redesign Map.md`, and the MVP plan.

## What the app is for

A tool for oral Bible translation (OBT) practitioners to **discover and describe
the local oral genres** of a language community, and then **use that genre
knowledge when creating or translating a passage** — so a translation lands in a
genre that fits its purpose and sounds native, not foreign. It grew out of
Katie's "Discovering Genres" OBT-CDT material. It is a facilitator's working
instrument, used with a community, mostly offline.

## How it is meant to work (two workspaces)

The home screen is the workflow chart. From it, two workspaces:

**Workspace 1 — Find & Describe Local Genres** (standalone ethnography, passage-
independent). Build a reusable description of the community's genres:
1a find/list genres + asking prompts · 1b genre basics and purpose families
(many-to-many) · 1c social side (associations, vitality, stable-vs-malleable) ·
1d big picture (×4) · 1e style (×6, each with a Required/Common feature table and
a localizable explainer) · 1f genre summary table (genres × features, configurable).

**Workspace 2 — Create / Translate** (passage-generic). Take a specific passage
through genre choice into a first draft:
2a passage setup · 2b genre chooser (purpose comparison → top-3 shortlist →
social-fit comb with per-passage green/yellow/red flags → lock-in with a
"we have a plan to handle these" guard) · 2c big-picture compare (passage beside
the chosen genre's conventions) · 2d style compare (Required features listed, a
plan box per feature) · 2e decisions summary + first draft in text or voice.

The two workspaces are deliberately separated: genre *description* is reusable
across passages; genre *application* is per-passage. Data set once in Workspace 1
should surface (not be re-entered) in Workspace 2.

## Design principles feedback should be weighed against

- **Local-first and offline.** Everything works with no network; sign-in/sync is
  optional. Don't accept changes that assume a server round-trip in the core flow.
- **Facilitator-friendly and low-friction.** Short steps, plain language,
  dictation-friendly. Register and wording must be localizable (explainers live
  in content config, not hard-coded).
- **Describe once, reuse everywhere.** Genre facts entered in Workspace 1 flow
  into Workspace 2; avoid designs that duplicate entry.
- **Nothing orphaned.** Stable content-node ids are preserved across redesigns;
  legacy features are re-homed, not dropped silently.
- **Two-way Required/Common scale**, per-passage-only fit flags, non-blocking
  nudges (e.g. the summary nudge never blocks), versioned genre edits with history.

## Non-goals (out of scope by design)

- Not a general Bible-translation suite, exegesis tool, or publishing pipeline.
- Not a cloud/collaboration platform; single-facilitator, local-first (Teams/sync
  are a thin optional layer, not the center).
- Not a genre *theory* teaching product; it operationalizes genre work, it doesn't
  lecture.
- Not tied to one language or one passage type; Workspace 1 is passage-independent
  and Workspace 2 is passage-generic.

## How to classify a comment against this

- **aligned** — consistent with the intended function; a bug, a rough edge, or a
  refinement within the existing design. Most feedback.
- **rework-toward-intent** — a substantive critique implying a larger change that
  would bring the app *more* in line with the intended function above (e.g. it
  removes a describe-twice duplication, or fixes a step that fights the two-
  workspace separation). Surface these prominently — they are the valuable ones.
- **misunderstands-system** — well-intentioned but based on not seeing how the
  whole fits together (e.g. asking to merge the two workspaces, add an online-only
  feature to the core flow, or reintroduce something deliberately re-homed). Park
  these with a one-line why; don't re-litigate them every batch.
