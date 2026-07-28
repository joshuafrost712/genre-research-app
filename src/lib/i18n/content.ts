/**
 * Locale-aware reads of worksheet content.
 *
 * `guide-content.json` stays the English source of truth; translations live
 * alongside it in `content/translations/<locale>.json` as a flat key map (see
 * `keys.ts`). Keeping them separate means the content-edit endpoint's
 * optimistic-concurrency guard keeps working on the English file untouched, and a
 * missing translation falls back to English for free.
 *
 * The main entry point is `localizedNode`, which returns a copy of a node with
 * every translatable string swapped, recursively. Consumers then render a node as
 * they always have, so no read site needs to know about locales.
 */
import type { ColumnDef, GuideNode, RowDef, SelectOption } from '../../schema/types'
import { SOURCE_LOCALE, type Locale } from './locales'
import { columnKey, columnOptionKey, nodeKey, optionKey, rowKey, type NodeField } from './keys'
import idCatalogue from '../../content/translations/id.json'

/**
 * Catalogues are bundled, not fetched: the app is offline-first and a facilitator
 * in the field must be able to switch language with no network. `$meta` is
 * documentation inside the JSON, not a translation key, so it is stripped.
 */
type Catalogue = Record<string, string>

function loadCatalogue(raw: unknown): Catalogue {
  const out: Catalogue = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '$meta') continue
    if (typeof value === 'string') out[key] = value
  }
  return out
}

const CATALOGUES: Record<Locale, Catalogue> = {
  en: {}, // the source language needs no catalogue
  id: loadCatalogue(idCatalogue),
}

/** Raw catalogue lookup. Empty and whitespace-only strings count as missing. */
export function translate(locale: Locale, key: string): string | undefined {
  if (locale === SOURCE_LOCALE) return undefined
  const hit = CATALOGUES[locale]?.[key]
  return hit && hit.trim() ? hit : undefined
}

/** How many keys a locale has, for the coverage report in the dev tools. */
export function catalogueSize(locale: Locale): number {
  return Object.keys(CATALOGUES[locale] ?? {}).length
}

/**
 * One translatable field, falling back to the English source. `source` is
 * returned unchanged when it is absent, so an untranslated optional field stays
 * absent rather than becoming an empty string.
 */
export function localizedField(
  nodeId: string,
  field: NodeField,
  locale: Locale,
  source: string | undefined,
): string | undefined {
  if (source === undefined) return undefined
  return translate(locale, nodeKey(nodeId, field)) ?? source
}

// Deep-mapping every render would be wasteful, and nodes are stable objects from
// a module-level JSON import, so cache per (locale, node). A WeakMap lets a node
// be collected if content is ever hot-reloaded.
const nodeCache = new Map<Locale, WeakMap<GuideNode, GuideNode>>()

function cacheFor(locale: Locale): WeakMap<GuideNode, GuideNode> {
  let m = nodeCache.get(locale)
  if (!m) {
    m = new WeakMap()
    nodeCache.set(locale, m)
  }
  return m
}

/** Test/HMR seam: drop memoized localized nodes. */
export function clearLocalizedCache(): void {
  nodeCache.clear()
}

function localizedOptions(
  nodeId: string,
  locale: Locale,
  options: SelectOption[] | undefined,
): SelectOption[] | undefined {
  if (!options) return undefined
  return options.map((o) => ({
    ...o,
    label: translate(locale, optionKey(nodeId, o.id)) ?? o.label,
  }))
}

function localizedColumns(
  nodeId: string,
  locale: Locale,
  columns: ColumnDef[] | undefined,
): ColumnDef[] | undefined {
  if (!columns) return undefined
  return columns.map((c) => ({
    ...c,
    label: translate(locale, columnKey(nodeId, c.id, 'label')) ?? c.label,
    help: c.help === undefined ? undefined : translate(locale, columnKey(nodeId, c.id, 'help')) ?? c.help,
    options: c.options?.map((o) => ({
      ...o,
      label: translate(locale, columnOptionKey(nodeId, c.id, o.id)) ?? o.label,
    })),
  }))
}

function localizedRows(
  nodeId: string,
  locale: Locale,
  rows: RowDef[] | undefined,
): RowDef[] | undefined {
  if (!rows) return undefined
  return rows.map((r) => ({
    ...r,
    label: translate(locale, rowKey(nodeId, r.id)) ?? r.label,
  }))
}

/**
 * A node with every translatable string swapped for `locale`, recursively through
 * `children`. Structural fields (`id`, `type`, `layer`, `minDepth`, `xref`, …) are
 * carried through untouched — only prose changes, so behaviour cannot diverge
 * between languages.
 */
export function localizedNode(node: GuideNode, locale: Locale): GuideNode {
  if (locale === SOURCE_LOCALE) return node

  const cache = cacheFor(locale)
  const hit = cache.get(node)
  if (hit) return hit

  const id = node.id
  const out: GuideNode = {
    ...node,
    label: translate(locale, nodeKey(id, 'label')) ?? node.label,
    guidance: localizedField(id, 'guidance', locale, node.guidance),
    footnote: localizedField(id, 'footnote', locale, node.footnote),
    help: localizedField(id, 'help', locale, node.help),
    example: localizedField(id, 'example', locale, node.example),
    options: localizedOptions(id, locale, node.options),
    columns: localizedColumns(id, locale, node.columns),
    rows: localizedRows(id, locale, node.rows),
    children: node.children?.map((c) => localizedNode(c, locale)),
  }

  cache.set(node, out)
  return out
}
