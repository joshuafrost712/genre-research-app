# Feedback inbox

In-app feedback lands here. Two sources write the same batch format:

- **Dev feedback** (Josh, `?dev=1` or local `vite dev`): highlight → comment →
  rank, plus edit-text-in-place. Anonymous.
- **Beta feedback** (external testers, `?beta=1`): highlight → comment only, no
  editing. Each batch is **tagged with the signed-in tester** (name + email), so
  comments can be grouped and weighted by person.

Batches arrive as one markdown file per submission in `incoming/`
(schema `genre.feedback-batch/v3`). Delivery: local dev writes straight into
`incoming/`; a deployed build POSTs to the Google Apps Script sink
(`feedback/server/`), which a poller syncs back into `incoming/` via
`npm run pull-feedback`. This is the same reusable widget documented in Cairn's
`docs/feedback-widget-pattern.md`.

## How to triage a batch (`/genre-feedback`)

When Josh says **"review the feedback batch"** (or runs `/genre-feedback`):

1. **Read `feedback/APP-INTENT.md` first**, then every file in `incoming/`. The
   intent file is the yardstick — classify against it, don't re-argue the design.
2. **Classify each comment** into exactly one bucket:
   - `aligned` — consistent with the intended function; a bug, rough edge, or
     refinement within the existing design.
   - `rework-toward-intent` — a substantive critique implying a larger change
     that would bring the app *more* into line with its intended function.
     **Surface these prominently** — they are the high-value ones.
   - `misunderstands-system` — well-intentioned but based on not seeing how the
     whole fits together. Park with a one-line why; don't re-litigate each batch.
3. **Group** the `aligned` + `rework-toward-intent` items by theme and shared
   root cause (use the importance ranks and the per-person tags). Recurring
   issues get fixed once, at the right altitude — not one comment at a time.
4. **Assess each item**: a one-line take, plus a **downstream-impact flag**:
   - `wording-only` — copy/label change, no logic.
   - `local-behavior` — affects one page/component's behavior.
   - `structural/system-wiring` — changes data model, cross-workspace flow, or
     shared contracts. Add a short note on what else it would touch (which
     nodes/routes/stores). These need Josh's judgment before any change.
5. **Write the report** to `feedback/reports/triage-<date>.md` (gitignored —
   it quotes testers). Format below.
6. **Get approval**, implement, then **move processed files** from `incoming/` to
   `processed/`. Never act on individual comments in isolation.

### Report format (`feedback/reports/triage-<date>.md`)

- Header: batch date(s), total comments, per-person counts.
- **"Flagged for discussion"** first: every `rework-toward-intent` item and every
  `structural/system-wiring` item, each with its assessment + impact note.
- Then grouped `aligned` sections (by theme), each item as:
  `- [importance] summary — assessment — <impact flag> — <deep-link>`
- A short **"Parked (misunderstands-system)"** list with one-line whys.

### Deep-link shape (open a comment in context)

Each comment carries `route`, and when the highlight sat on a tagged element,
`nodeId` (+ `field`). Build a link that opens the **live app** and flashes the
spot:

```
https://joshuafrost712.github.io/genre-research-app/?fbroute=<route>&fb=<nodeId>[&fbf=<field>][&fbt=<encoded selection text>]
```

The link targets the base URL with query params (not a real sub-path) so it works
on GitHub Pages without a 404 fallback; the app routes to `<route>` client-side,
scrolls to `[data-dfb-node="<nodeId>"]`, and briefly highlights it. When a comment
has no `nodeId`, omit `fb` and pass `fbt` (the highlighted text) so the app finds
it by text match.

### Cost note

The first-pass grouping can be probed on local Qwen (`qwen3.5:9b`) for high-volume
batches, but the alignment-vs-intent call and the downstream-impact assessment are
judgment — keep those on Claude. Batches are small (~6–15), so a Claude pass is the
economical default.

## Folders

- `incoming/` — unhandled batches. Gitignored (transient working artifacts).
- `processed/` — batches already turned into a plan. Gitignored.
- `reports/` — triage reports. Gitignored (they quote external testers).
