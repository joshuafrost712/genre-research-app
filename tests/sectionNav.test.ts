import { describe, expect, it } from 'vitest'
import { journeyOrder, nextNavId, prevNavId } from '../src/lib/content/loader'

/**
 * Back navigation, added after workshop feedback on 2026-08-25 ("it would be
 * nice if there was also a back arrow ... we keep losing our way a bit").
 *
 * The property that matters to a person using it is reversibility: the Back
 * button has to undo the Next button exactly, on every section, or going back
 * lands you somewhere you have never been — which is worse than no back button
 * at all for someone who is already lost.
 */
describe('prevNavId', () => {
  it('exactly reverses nextNavId across the whole journey', () => {
    const order = journeyOrder()
    expect(order.length).toBeGreaterThan(1)
    for (const id of order) {
      const next = nextNavId(id)
      if (!next) continue // the last subsection has nothing after it
      expect(prevNavId(next), `back from ${next}`).toBe(id)
    }
  })

  it('walks the journey backwards to the start, visiting every subsection', () => {
    const order = journeyOrder()
    const walked: string[] = []
    let at: string | null = order[order.length - 1]
    while (at) {
      walked.unshift(at)
      at = prevNavId(at)
    }
    expect(walked).toEqual(order)
  })

  it('has no previous section at the start of the journey', () => {
    expect(prevNavId(journeyOrder()[0])).toBeNull()
  })

  it('offers no guess for an id off the recommended path', () => {
    // Unlike nextNavId, which falls back to the first subsection, back from
    // nowhere stays null rather than sending someone to the end of the path.
    expect(prevNavId('chrome.describe')).toBeNull()
    expect(prevNavId('no-such-node')).toBeNull()
    expect(prevNavId(null)).toBeNull()
  })
})
