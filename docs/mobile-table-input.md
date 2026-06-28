# Filling tables on a phone — design options (pick one)

## Decision (2026-06-27): built the A + B blend

Josh chose the **A + B blend**, now the shared renderer for every
`repeatable_row_table` and `fixed_grid` (see `RepeatableTable` / `FixedGrid` in
`src/components/blocks/BlockRenderer.tsx`). A row collapses to a tappable summary
— a headline (its first answer, or the fixed row's label) plus a chip per field,
green when filled and grey when empty. Tapping a row (or a chip) opens a
one-field-at-a-time mini-form with Back / Skip / Next and a progress-dot row.
This replaced the old scroll-down stack across 1C-area tables, 2C, 2D, 3A, and
the Section 0 grids. The options below are kept as the original design record.

## The problem Katie named

Several worksheet questions are really tables: one row per thing (a feeling, a
genre, a figure of speech), and several fields per row. The widest are **1B**
(9 fields per genre) and **2C** (8 fields per feeling).

On paper a table reads **across**: you put a thing on the left and continue the
thought rightward. The current app turns every row into a tall stack of fields
you scroll **down** through. Katie's point: down-scrolling breaks the "continue
one idea" feeling, the rows blur together, and it is tiring rather than
inviting. She wants something **mobile-first, intuitive, and even fun**, and she
wants it to become the default for every table-like question.

This doc proposes three patterns. Each is described for a phone first, with an
ASCII mock-up and the trade-offs. **No code is written yet — this is for you to
choose.** Whatever you pick becomes the shared renderer for
`repeatable_row_table` and `fixed_grid`, so it changes 1B, 2C, 2D, 3A, 3D at once.

A note that applies to all three: many fields are often blank (not every feeling
uses an instrument). So every pattern needs an easy, visible **"not here / skip"**
that is faster than typing, and never makes a blank field feel like a chore.

## Option A — One field at a time (a guided mini-form per row)

Each row is entered as a short, friendly wizard: the thing first, then one field
per screen with a big input and Next/Skip. A small progress dot row shows how
many fields are left. When done, the row collapses to a one-line summary you can
tap to reopen. Adding a row starts a fresh mini-form.

```
  ┌─────────────────────────────┐      ┌─────────────────────────────┐
  │  New feeling                │      │  Joy ·  ●●●○○○○○             │
  │                             │      │                             │
  │  What feeling?              │      │  Instruments / objects?     │
  │  ┌───────────────────────┐  │  →   │  ┌───────────────────────┐  │
  │  │ Joy                   │  │      │  │ hand drum, clapping   │  │
  │  └───────────────────────┘  │      │  └───────────────────────┘  │
  │                             │      │                             │
  │            [ Next → ]       │      │  [ Skip ]        [ Next → ] │
  └─────────────────────────────┘      └─────────────────────────────┘

  Finished rows collapse:
  ▸ Joy — hand drum; bright voice; fast claps            (tap to edit)
  ▸ Sorrow — slow flute; bowed head                      (tap to edit)
  [ + Add a feeling ]
```

- **Good:** one idea on screen at a time; reads like a conversation; Skip makes
  blanks painless; least overwhelming; great through Google Translate (little
  text per screen).
- **Less good:** more taps to move between fields; harder to see a whole row at
  once while typing; editing one field later is a couple of taps in.
- **Best when:** the audience is new, on a small phone, working alone — which is
  exactly our case.

## Option B — Chips you tap to open (progressive disclosure)

The row shows the "thing" field plus a row of **chips**, one per field. A chip is
grey when empty, colored when filled. Tap a chip to open just that field inline;
tap "not here" to grey it out on purpose. You fill only what matters and see the
whole row's state at a glance.

```
  ┌──────────────────────────────────────────────┐
  │  Feeling:  [ Joy___________ ]                  │
  │                                                │
  │  ◍ Instruments  ○ Picture-language  ○ Look-at  │
  │  ◍ Body         ○ Rhythm   ○ Voice   ○ Other   │
  │     ▲ tap a chip to fill it; long-press = skip │
  │                                                │
  │  ▼ Instruments (open)                          │
  │  ┌──────────────────────────────────────────┐ │
  │  │ hand drum, clapping                       │ │
  │  └──────────────────────────────────────────┘ │
  └──────────────────────────────────────────────┘
   ◍ = filled    ○ = empty    ⦸ = marked "not here"
```

- **Good:** whole row visible at once; you choose what to fill; filled/empty is
  obvious; compact; "fun" tactile feel; blanks are a deliberate tap, not a void.
- **Less good:** chips + states are a small concept to learn (the tour can cover
  it); long field labels get clipped to fit a chip; two-step to start typing.
- **Best when:** rows have many *optional* fields (our wide tables), and the user
  will skip most of them.

## Option C — Swipe across the fields (one row, slide sideways)

Keep the paper feeling: the row stays one unit and you **swipe left/right**
through its fields, one field filling the screen, with the thing's name pinned at
the top so you never lose context. Dots show position in the row. This restores
the "continue the idea sideways" motion Katie described.

```
        pinned:  Feeling — Joy
  ┌─────────────────────────────────────────────┐
  │  ‹  Instruments / objects        (2 of 8)  › │
  │                                              │
  │  ┌────────────────────────────────────────┐ │
  │  │ hand drum, clapping                     │ │
  │  └────────────────────────────────────────┘ │
  │                                              │
  │   ●  ●  ○  ○  ○  ○  ○  ○      [ skip ]       │
  └─────────────────────────────────────────────┘
        swipe →  to the next field;  swipe ←  to go back
```

- **Good:** matches the across-the-page mental model; the pinned name keeps
  context; one field at a time like A, but feels continuous, not like a form.
- **Less good:** swipe gestures are easy to miss without a hint; accessibility
  needs visible ‹ › arrows as well as swipe; hardest of the three to build well;
  horizontal scrolling can fight the browser on some phones.
- **Best when:** preserving the paper-table feel matters most and we can invest
  in getting the gesture polish right.

## Recommendation

For our users — new to this, on phones, reading through Google Translate, working
alone — **Option A (one field at a time)** is the safest and least overwhelming,
and **Option B (chips)** is the best fit for the *wide, mostly-optional* tables
(1B, 2C) because skipping is first-class and the whole row stays visible. A strong
path is **A as the default, with B's chip summary as the collapsed row view** — you
get the gentle one-field entry and the at-a-glance overview together.

Option C is the most faithful to the paper table and the most "fun," but it is the
most work and the riskiest on mobile browsers; worth it only if the sideways feel
is a priority.

Tell me which to build (or a blend) and I will implement it as the shared table
renderer.