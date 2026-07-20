/**
 * The summary mechanic behind the 1f genre summary table. Long conversational
 * answers are great record-keeping; the table needs one-line versions. A
 * companion summary rides the same node as a `__summary` cell entry, and a
 * non-blocking nudge appears when an answer runs long. Pure helpers over a
 * plain Entry[] so the table and the nudge stay testable without IndexedDB.
 */
import { effectiveLayer, findNode, navTree } from './loader'
import { answerableLeaves } from '../progress'
import type { Entry } from '../types'
import type { GuideNode, SelectOption } from '../../schema/types'

export const SUMMARY_KEY = '__summary'
export const SUMMARY_WORD_LIMIT = 15
export const SUMMARY_CHAR_LIMIT = 120

/** True when an answer is long enough that the table wants a one-line summary. */
export function needsSummary(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return t.split(/\s+/).length > SUMMARY_WORD_LIMIT || t.length > SUMMARY_CHAR_LIMIT
}

const SCALAR_TYPES = new Set(['short_text', 'long_text', 'single_select', 'multi_select'])

/** The computed "Required features" column (from the 1e feature tables). */
export const REQUIRED_COL = '__required'

/** Synthesis node holding the per-feature translation plans (2d left column). */
export const STYLE_IDEA_NODE = 'style.idea'

/** Default table columns: content, who participates, and what types of events. */
export const DEFAULT_COLUMNS = ['s1b.content', 's2eth.who', 's2eth.when']

export interface SummaryColumnDef {
  id: string // a genre-layer node id, or REQUIRED_COL
  label: string
  subLabel: string
}

/** Every column the table can show: the genre-layer scalar prompts + Required features. */
export function columnCatalog(): SummaryColumnDef[] {
  const out: SummaryColumnDef[] = [
    { id: REQUIRED_COL, label: 'Required features', subLabel: 'from the style pages (1e)' },
  ]
  for (const { subsections } of navTree()) {
    for (const sub of subsections) {
      if (effectiveLayer(sub.id) !== 'genre') continue
      for (const leaf of answerableLeaves(sub, 'comprehensive')) {
        if (!SCALAR_TYPES.has(leaf.type)) continue
        out.push({ id: leaf.id, label: shortPrompt(leaf), subLabel: sub.label })
      }
    }
  }
  return out
}

/** Genre-layer feature tables that carry the Required/Common modality column. */
export function featureTableIds(): string[] {
  const ids: string[] = []
  for (const { subsections } of navTree()) {
    for (const sub of subsections) {
      if (effectiveLayer(sub.id) !== 'genre') continue
      for (const leaf of answerableLeaves(sub, 'comprehensive')) {
        if (
          leaf.type === 'repeatable_row_table' &&
          leaf.columns?.some((c) => c.id === 'modality')
        ) {
          ids.push(leaf.id)
        }
      }
    }
  }
  return ids
}

export interface SummaryCell {
  text: string
  /** The full answer was long and shown truncated (no one-line summary yet). */
  missingSummary: boolean
}

/** The display value of one table cell for one genre. */
export function summaryCell(entries: Entry[], genreId: string, colId: string): SummaryCell {
  if (colId === REQUIRED_COL) {
    return { text: requiredFeatures(entries, genreId).join(' · '), missingSummary: false }
  }
  const node = findNode(colId)?.node
  if (!node) return { text: '', missingSummary: false }

  const base = entries.find((e) => e.node_id === colId && e.genre_id === genreId && !e.cell_key)
  if (node.type === 'single_select') {
    return { text: optionLabel(node.options, base?.value ?? ''), missingSummary: false }
  }
  if (node.type === 'multi_select') {
    const ids = parseIdArray(base?.value)
    return {
      text: ids.map((id) => optionLabel(node.options, id)).join(', '),
      missingSummary: false,
    }
  }

  const full = (base?.text ?? '').trim()
  const summary = (
    entries.find(
      (e) => e.node_id === colId && e.genre_id === genreId && e.cell_key === SUMMARY_KEY,
    )?.text ?? ''
  ).trim()
  if (summary) return { text: summary, missingSummary: false }
  if (!needsSummary(full)) return { text: full, missingSummary: false }
  return { text: `${full.slice(0, SUMMARY_CHAR_LIMIT)}…`, missingSummary: true }
}

/** The genre's Required features across every 1e feature table, headlines only. */
export function requiredFeatures(entries: Entry[], genreId: string): string[] {
  const out: string[] = []
  for (const tableId of featureTableIds()) {
    const order = parseIdArray(
      entries.find(
        (e) => e.node_id === tableId && e.genre_id === genreId && e.cell_key === '__rows',
      )?.value,
    )
    for (const rowId of order) {
      const modality = entries.find(
        (e) => e.node_id === tableId && e.genre_id === genreId && e.cell_key === `${rowId}__modality`,
      )?.value
      if (modality !== 'required') continue
      const feature = (
        entries.find(
          (e) => e.node_id === tableId && e.genre_id === genreId && e.cell_key === `${rowId}__feature`,
        )?.text ?? ''
      ).trim()
      if (feature) out.push(feature)
    }
  }
  return out
}

export interface RequiredFeature {
  tableId: string
  rowId: string
  areaLabel: string // e.g. "Words", "Sounds"
  text: string
}

/** Required features with their source table + row, for the 2d compare page. */
export function requiredFeatureRefs(entries: Entry[], genreId: string): RequiredFeature[] {
  const out: RequiredFeature[] = []
  for (const tableId of featureTableIds()) {
    const ref = findNode(tableId)
    const areaLabel = ref?.parents[ref.parents.length - 1]?.label ?? tableId
    const order = parseIdArray(
      entries.find(
        (e) => e.node_id === tableId && e.genre_id === genreId && e.cell_key === '__rows',
      )?.value,
    )
    for (const rowId of order) {
      const modality = entries.find(
        (e) => e.node_id === tableId && e.genre_id === genreId && e.cell_key === `${rowId}__modality`,
      )?.value
      if (modality !== 'required') continue
      const text = (
        entries.find(
          (e) => e.node_id === tableId && e.genre_id === genreId && e.cell_key === `${rowId}__feature`,
        )?.text ?? ''
      ).trim()
      if (text) out.push({ tableId, rowId, areaLabel: cleanAreaLabel(areaLabel), text })
    }
  }
  return out
}

export interface CoverageFamily {
  id: string
  label: string
  genreNames: string[]
}

/**
 * The coverage panel: for each purpose family, which genres can serve it. One
 * genre can serve several families (the purposes multi-select is many-to-many).
 */
export function purposeCoverage(
  entries: Entry[],
  genres: Array<{ id: string; name: string }>,
): CoverageFamily[] {
  const node = findNode('s1b.purpose_families')?.node
  const families = (node?.options ?? []).filter((o) => o.id !== 'other')
  return families.map((f) => ({
    id: f.id,
    label: f.label,
    genreNames: genres
      .filter((g) => {
        const e = entries.find(
          (x) => x.node_id === 's1b.purpose_families' && x.genre_id === g.id && !x.cell_key,
        )
        return parseIdArray(e?.value).includes(f.id)
      })
      .map((g) => g.name),
  }))
}

/** A compact column label from a prompt: first clause, genre token neutralized. */
export function shortPrompt(node: GuideNode): string {
  const head = node.label
    .replace(/\{genre\}/g, 'the genre')
    .split(/[(?]/)[0]
    .trim()
  return head.length > 48 ? `${head.slice(0, 47)}…` : head
}

function cleanAreaLabel(label: string): string {
  // "1e.3: The Sounds of {genre}" -> "The Sounds"
  return label
    .replace(/^\S+:\s*/, '')
    .replace(/\s*(of|in)\s*\{genre\}.*$/i, '')
    .replace(/\{genre\}/g, 'the genre')
    .trim()
}

function optionLabel(options: SelectOption[] | undefined, value: string): string {
  if (!value) return ''
  return options?.find((o) => o.id === value)?.label ?? value
}

function parseIdArray(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}
