/**
 * Build-time feature switches.
 */

/**
 * Teams: shared work between people on the same project.
 *
 * OFF while it is rebuilt. The Drive implementation (`lib/sync/teams.ts`) is the
 * only caller of the **restricted** full `drive` OAuth scope, and declaring that
 * scope is what forced the whole app into Google's unverified/Testing posture:
 * only accounts on a test-user list could sign in at all, each consent expired
 * after seven days, and organization-managed accounts were blocked outright. Every
 * other Google use here needs only the non-sensitive `drive.file`, which requires
 * no Google review.
 *
 * It was also never live in the sense people assumed: a teammate's answer took
 * roughly 25 to 48 seconds to appear, because sync was a 45-second poll against a
 * shared Drive folder.
 *
 * The replacement is Postgres plus Supabase Realtime: sub-second, works with any
 * email address, no Google involved, and it doubles as the off-device backup the
 * app currently lacks. When that ships, delete `lib/sync/teams.ts`, the Drive team
 * pages, and `SCOPES.full` outright rather than flipping this back on.
 *
 * Confirmed with Joshua on 2026-08-06 that nobody was using the Drive version.
 * Nothing in anyone's Drive is touched by turning this off; the folders remain.
 */
export const TEAMS_ENABLED = false
