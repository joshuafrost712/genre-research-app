/**
 * Build-time feature switches.
 *
 * `TEAMS_ENABLED` used to live here, switched off while shared work moved off
 * Google Drive. It is gone: shared worksheets now run on Postgres plus the same
 * sync every signed-in device uses, so the feature gates on whether a Supabase
 * project is configured (`isSupabaseConfigured()`) rather than on a constant.
 * The Drive implementation, its pages' dependence on it, and the restricted full
 * `drive` OAuth scope that forced the whole client into Google's Testing status
 * were all deleted on 2026-08-06 rather than left switched off.
 */

export {}
