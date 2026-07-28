/**
 * The translation-key scheme for worksheet content.
 *
 * This module is the SINGLE source of truth for how a translatable string in
 * `guide-content.json` maps to a key in `content/translations/<locale>.json`.
 * Both sides depend on it — the runtime accessor (`lib/i18n/content.ts`) and the
 * extraction script (`scripts/extract-strings.ts`) — so the writer and the reader
 * can never drift. A drift here would silently fall every string back to English.
 *
 * Keys are built from the node's stable `id`, never from its text, matching the
 * worksheet's existing rule that answers bind to ids so a prompt can be re-worded
 * without orphaning stored data. Re-wording English therefore keeps the
 * translation attached; only changing an `id` orphans one.
 */

/** Node-level string fields that carry translatable prose. */
export const NODE_FIELDS = ['label', 'guidance', 'footnote', 'help', 'example'] as const
export type NodeField = (typeof NODE_FIELDS)[number]

/** Column-level string fields on a table/grid column definition. */
export const COLUMN_FIELDS = ['label', 'help'] as const
export type ColumnField = (typeof COLUMN_FIELDS)[number]

/** `s1b.label`, `s1b.guidance`, … */
export function nodeKey(nodeId: string, field: NodeField): string {
  return `${nodeId}.${field}`
}

/** A select option's label: `s1c.option.strong`. */
export function optionKey(nodeId: string, optionId: string): string {
  return `${nodeId}.option.${optionId}`
}

/** A table column's label or help text: `s3a.column.feature.label`. */
export function columnKey(nodeId: string, columnId: string, field: ColumnField): string {
  return `${nodeId}.column.${columnId}.${field}`
}

/** An option on a select-typed column: `s3a.column.status.option.required`. */
export function columnOptionKey(nodeId: string, columnId: string, optionId: string): string {
  return `${nodeId}.column.${columnId}.option.${optionId}`
}

/** A fixed_grid row's label: `s2d.row.joy`. */
export function rowKey(nodeId: string, rowId: string): string {
  return `${nodeId}.row.${rowId}`
}
