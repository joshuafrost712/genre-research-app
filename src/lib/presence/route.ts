/**
 * Which worksheet node a path is showing, for presence.
 *
 * Read from the PATH rather than from `useParams()`, because the provider mounts
 * in `Layout`, which is the parent route: `:nodeId` belongs to the child route's
 * segment, so `useParams()` there returns an empty object and every dot would
 * silently land nowhere.
 *
 * Pure and tested for the same reason `derive.ts` is: it decides what a person
 * sees, and it is the half of presence that can be wrong without erroring.
 */
import { journey, SUB_PAGE_ROUTES } from '../content/loader'

/**
 * Every route the nav offers that maps to a node id, inverted.
 *
 * Two sources, and both are derived rather than retyped so a new page cannot
 * leave presence pointing at a route that no longer exists:
 *
 * 1. `SUB_PAGE_ROUTES` — the three subsections whose worksheet route is
 *    superseded by a dedicated page (`/choose`, `/macro`, `/style`). The sidebar
 *    links these as `/worksheet/<id>` and WorksheetView redirects.
 * 2. The journey's GROUP rows. `s2` and `s3` are linked as `/describe/big-picture`
 *    and `/describe/style`, which match neither the map above nor
 *    `/worksheet/<id>` — so before this, the group node ids `NavShell` passes to
 *    `PresenceDots` could never match anything, and a person sitting on a group
 *    landing page was counted in the header while showing no dot anywhere. The
 *    same failure the point above exists to prevent, one level up the tree.
 *
 * Stage landings (`/describe`, `/summary`) are deliberately absent: a stage is
 * not a node, so somebody standing on one is present in the project and on no
 * tab, exactly like the genres page.
 */
const PAGE_TO_NODE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SUB_PAGE_ROUTES).map(([subId, route]) => [route, subId])),
  ...Object.fromEntries(
    journey().flatMap((stage) => (stage.groups ?? []).map((g) => [g.route, g.nodeId])),
  ),
}

/**
 * The node id a pathname is on, or null.
 *
 * Null is a first-class answer, not a failure: the genres page, the report, the
 * team page and home have no tab in the worksheet nav, and somebody standing on
 * one of them is present in the project without being present on any node. The
 * header counts them; the sidebar does not.
 */
export function nodeIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  // Trailing slashes and a doubled slash both arrive from real links.
  const path = pathname.replace(/\/+$/, '') || '/'

  const mapped = PAGE_TO_NODE[path]
  if (mapped) return mapped

  const match = /^\/worksheet\/([^/]+)$/.exec(path)
  if (!match) return null
  // A route param arrives percent-encoded. Node ids are plain (`s1.setting`), so
  // a decode failure means it was never one of ours.
  try {
    return decodeURIComponent(match[1]) || null
  } catch {
    return null
  }
}
