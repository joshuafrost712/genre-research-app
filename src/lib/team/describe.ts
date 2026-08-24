/**
 * How a team is described to a person in one line.
 *
 * Extracted from ProjectPicker, which had worked this out already and kept it to
 * itself: the passages in a worksheet are how somebody actually tells two apart,
 * and for most of the Psalms workshop they were the ONLY distinguishing thing on
 * screen, because every project was called "Untitled project". Now that teams can
 * be named the passage line is the second line rather than the first, but it is
 * still what confirms you are in the right place.
 */

/** "Psalm 124, Psalm 1 +3 more" — enough to recognise, short enough to read. */
export function describePassages(passages: string[]): string {
  if (passages.length === 0) return 'no passages yet'
  const shown = passages.slice(0, 2).join(', ')
  return passages.length > 2 ? `${shown} +${passages.length - 2} more` : shown
}

/** "4 people", "just you". Plain counts; the names live on the team page. */
export function describeMembers(memberCount: number): string {
  if (memberCount <= 1) return 'just you'
  return `${memberCount} people`
}
