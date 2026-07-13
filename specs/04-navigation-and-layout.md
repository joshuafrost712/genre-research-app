# Spec 04 — Home/Start affordance; sticky sidebar

**Owns:** #6 (high), #9 (med), #10 (med).
**Priority:** High (#6) / Med.

## Goal

Give users an obvious way back to the home/start page from anywhere, and let the
left menu scroll independently so they can read their answers while picking the
next thing to fill in.

## Current state (confirmed)

- **Router** (`src/App.tsx:22-47`): all routes are children of `Layout` at `/`;
  home (`/`) is `Dashboard`; worksheets are `worksheet/:nodeId`.
- **Home link** exists only as the header title (`src/components/Layout.tsx:34-36`,
  a `<Link to="/">`) and a bottom "Home" link in `WorksheetView`
  (`src/pages/WorksheetView.tsx:88-90`). There is **no Home/Start entry in
  `NavShell` QUICK_LINKS** (`src/components/NavShell.tsx:28-41`) and **none on the
  Genres page** (`GenreBank.tsx`) → #9, #10.
- **Landing** (`src/pages/Dashboard.tsx`): the "let's get started" box is
  `SetupCard` (`:142-163`) — a link to `/genres`, not a labeled Start button. A
  big Continue/Start button exists at `:86-94` but only once set up → #10.
- **Sidebar scroll** (`src/components/Layout.tsx`): the `<aside className="hidden
  w-72 shrink-0 border-r … lg:block">` (`:44`) has **no** `sticky`, `h-screen`,
  or `overflow`, so it scrolls with the page. `NavShell`'s inner tree already has
  `overflow-y-auto` (`NavShell.tsx:113`) but it never engages because the aside is
  unbounded. The mobile drawer already scrolls (`Layout.tsx:55`). → #6.

## Target behavior

- A clear, always-available way back to Home from `/genres` and from the landing
  box, plus a Home entry in the side menu.
- On wide screens the left menu is fixed height and scrolls on its own; the
  worksheet content scrolls independently, so a long menu never forces the whole
  page to scroll and the user's typed answers stay in view.

## Implementation notes

### A. Sticky, independently scrollable sidebar (#6)

Bound the aside's height and let it scroll. In `Layout.tsx:44`, make the
`<aside>`:
```
sticky top-0 h-dvh overflow-y-auto
```
(or `h-[calc(100dvh)]` with the header accounted for if the header is inside the
scroll region). Confirm the flex row (`Layout.tsx:43`, `flex flex-1`) and outer
shell (`:22`, `flex min-h-dvh flex-col`) don't fight the sticky — the aside must
be able to reach full viewport height. Once bounded, the existing
`overflow-y-auto` on the `NavShell` section tree (`NavShell.tsx:113`) engages so
the section list scrolls within the menu while the header/quick-links stay put.
Verify the worksheet `<main>` content scrolls independently and the page body
never double-scrolls.

### B. Home/Start affordance (#9, #10)

- Add a **Home** entry to `NavShell` QUICK_LINKS (`NavShell.tsx:28-41`) linking
  to `/` — this alone gives every page (including `/genres`, since it uses the
  same shell) a menu route home. Simplest, covers #9 and #10's "way back."
- On the landing `SetupCard` (`Dashboard.tsx:142-163`): make the primary action
  a clearly labeled **Start** button (not just a text link), and ensure it reads
  "Start" for a new user (the `:86-94` button already switches Start/Continue —
  bring that affordance into the setup state or add a Start button to the card).
- Optionally add a small "Home" link on the Genres page header
  (`GenreBank.tsx:59-63`) for redundancy on the page Katie flagged (#9).

## Acceptance criteria

- From `/genres` and from the landing box, Home is one obvious click away.
- New users see a labeled **Start** button.
- On a wide screen, scrolling a long section menu does not scroll the worksheet;
  the answers being typed stay visible; the page body does not scroll
  horizontally or double-scroll.
- Mobile drawer behavior is unchanged.
- `npm run build` clean.
