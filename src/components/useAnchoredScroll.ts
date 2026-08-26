/**
 * Keep the question you were looking at under your eyes across a genre switch.
 *
 * Restoring by anchor rather than by offset, for two reasons.
 *
 * The mechanical one: the scroll container is `<main class="overflow-y-auto">`
 * in Layout, not the window, so `window.scrollY` is always 0. And a saved
 * `scrollTop` cannot simply be written back either, because the page renders
 * "Loading…" while its live queries re-resolve against the new context. The
 * container collapses to a few lines, the browser clamps `scrollTop` to 0, and
 * the restore lands at the top having reported success.
 *
 * The honest one: offsets are not what anyone wants preserved. Two genres give
 * different-length answers to the same question, so the same pixel offset is a
 * different question. Staying on the *block* is the actual intent.
 */

const SCROLL_CONTAINER = 'main'
const ANCHOR_ATTR = 'data-dfb-node'

/** Frames to wait for the block to come back after the remount, then give up. */
const MAX_FRAMES = 20

/**
 * The id of the topmost content block currently in view, or null if the page is
 * already at the top (where there is nothing to restore) or carries no blocks.
 *
 * `data-dfb-node` is on every rendered block already, for the dev-feedback
 * selection layer. Reusing it means no new attribute has to be threaded through
 * BlockRenderer, and the two features stay in step by construction.
 */
export function captureAnchor(): string | null {
  const container = document.querySelector(SCROLL_CONTAINER)
  if (!container) return null
  // Already at the top: restoring would be a no-op at best, and at worst would
  // scroll the section heading out of view to satisfy a block that was never
  // scrolled to in the first place.
  if (container.scrollTop < 8) return null

  const top = container.getBoundingClientRect().top
  for (const el of container.querySelectorAll(`[${ANCHOR_ATTR}]`)) {
    // The first block whose bottom edge is still below the fold: the one a
    // reader would say they are "on", even if its first line is cut off.
    if (el.getBoundingClientRect().bottom > top + 4) {
      return el.getAttribute(ANCHOR_ATTR)
    }
  }
  return null
}

/**
 * Scroll `id` back to the top of the container once it exists again.
 *
 * Polls animation frames rather than waiting a fixed delay: the remount plus a
 * Dexie round-trip has no fixed duration, and a `setTimeout` long enough to be
 * safe on a slow phone is long enough to be seen as a jump on a laptop. Gives
 * up silently, because a block that legitimately does not exist in the new
 * genre (a depth-mode difference, say) is not an error worth showing anyone.
 */
export function restoreAnchor(id: string | null): void {
  if (!id) return
  let frames = 0
  const attempt = () => {
    const el = document.querySelector(`[${ANCHOR_ATTR}="${CSS.escape(id)}"]`)
    if (el) {
      el.scrollIntoView({ block: 'start' })
      return
    }
    if (++frames < MAX_FRAMES) requestAnimationFrame(attempt)
  }
  requestAnimationFrame(attempt)
}
