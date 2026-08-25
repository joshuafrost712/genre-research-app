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
import { SUB_PAGE_ROUTES } from '../content/loader'

/**
 * The three subsections whose worksheet route is superseded by a dedicated page
 * (`/choose`, `/macro`, `/style`), inverted.
 *
 * Derived from the forward map rather than retyped, so adding a fourth dedicated
 * page cannot leave presence pointing at a route that no longer exists. The
 * sidebar links these tabs as `/worksheet/<id>` and WorksheetView redirects, so
 * without this a person sitting on a tab the nav itself offers would show no dot
 * there — which reads as a broken feature rather than as the deferred scope it is.
 */
const PAGE_TO_SUB: Record<string, string> = Object.fromEntries(
  Object.entries(SUB_PAGE_ROUTES).map(([subId, route]) => [route, subId]),
)

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

  const mapped = PAGE_TO_SUB[path]
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
