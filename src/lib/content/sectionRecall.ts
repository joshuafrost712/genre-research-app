/**
 * Read-only recall of work already done, so a team never re-enters it (feedback
 * #5, #22, #23). Pure helpers over a plain `Entry[]` (one query, testable
 * without IndexedDB), mirroring `compareSummary.ts`.
 *
 * `deriveSectionRecall` condenses everything a team wrote in a Section 3
 * subsection (for the active genre) into label/value fields, so those
 * observations can be shown in the matching stylistic-notes step. Starred table
 * rows come first and are marked. `translationSummary` gathers the psalm purpose,
 * the chosen genre, and the starred stylistic priorities for the drafting step.
 */
import { findNode } from './loader'
import { answerableLeaves } from '../progress'
import type { Entry } from '../types'
import type { GuideNode, SelectOption } from '../../schema/types'

export interface SummaryField {
  label: string
  value: string
  starred?: boolean
}

const ROWS_KEY = '__rows'

function trimmed(s: string | undefined): string {
  return (s ?? '').trim()
}

function optionLabel(options: SelectOption[] | undefined, value: string): string {
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

function rowOrder(entries: Entry[], nodeId: string, genreId: string): string[] {
  const sidecar = entries.find(
    (e) => e.node_id === nodeId && e.genre_id === genreId && e.cell_key === ROWS_KEY,
  )
  return parseIdArray(sidecar?.value)
}

/** The scalar (cell_key-less) entry for a genre-layer node. */
function scalar(entries: Entry[], nodeId: string, genreId: string): Entry | undefined {
  return entries.find((e) => e.node_id === nodeId && !e.cell_key && e.genre_id === genreId)
}

/**
 * Everything a team recorded in one Section 3 subsection, for the active genre,
 * as display fields. Handles the subsection's scalar prompts (text + selects)
 * and any repeatable table (rows first-column headline, starred rows marked and
 * sorted to the top). Empty answers are dropped.
 */
export function deriveSectionRecall(
  entries: Entry[],
  subId: string,
  genreId: string,
  detailed = false,
): SummaryField[] {
  const ref = findNode(subId)
  if (!ref) return []
  const leaves = answerableLeaves(ref.node, 'comprehensive')
  const out: SummaryField[] = []
  for (const leaf of leaves) {
    switch (leaf.type) {
      case 'short_text':
      case 'long_text':
      case 'genre_select': {
        const v = trimmed(scalar(entries, leaf.id, genreId)?.text)
        if (v) out.push({ label: promptLabel(leaf), value: v })
        break
      }
      case 'single_select':
      case 'three_point_scale': {
        const val = scalar(entries, leaf.id, genreId)?.value
        if (val) out.push({ label: promptLabel(leaf), value: optionLabel(leaf.options, val) })
        break
      }
      case 'multi_select': {
        const ids = parseIdArray(scalar(entries, leaf.id, genreId)?.value)
        if (ids.length) {
          const labels = ids.map((id) => optionLabel(leaf.options, id)).join(', ')
          out.push({ label: promptLabel(leaf), value: labels })
        }
        break
      }
      case 'repeatable_row_table':
      case 'repeatable_list':
        out.push(...tableRows(entries, leaf, genreId, detailed))
        break
      default:
        break
    }
  }
  return out
}

/**
 * Rows of a repeatable table/list, starred first and marked. When `detailed`,
 * the row's other filled columns are appended after the headline in parentheses
 * (used on 2c so each named feeling shows how the genre conveys it — feedback
 * 2026-07-22 #4).
 */
function tableRows(
  entries: Entry[],
  node: GuideNode,
  genreId: string,
  detailed = false,
): SummaryField[] {
  const cols = node.columns ?? []
  const firstCol = cols[0]
  const cell = (rowId: string, colId: string) =>
    trimmed(
      entries.find(
        (e) => e.node_id === node.id && e.genre_id === genreId && e.cell_key === `${rowId}__${colId}`,
      )?.text,
    )
  const rows = rowOrder(entries, node.id, genreId).map((rowId) => {
    const headline = firstCol
      ? cell(rowId, firstCol.id)
      : trimmed(
          entries.find((e) => e.node_id === node.id && e.genre_id === genreId && e.cell_key === rowId)?.text,
        )
    const detail =
      detailed && firstCol
        ? cols
            .slice(1)
            .map((c) => ({ label: chipLabel(c.label), value: cell(rowId, c.id) }))
            .filter((d) => d.value)
            .map((d) => `${d.label}: ${d.value}`)
            .join('; ')
        : ''
    const starred =
      entries.find((e) => e.node_id === node.id && e.genre_id === genreId && e.cell_key === rowId)
        ?.is_priority === true
    return { headline: detail ? `${headline} (${detail})` : headline, starred }
  })
  return rows
    .filter((r) => r.headline)
    .sort((a, b) => Number(b.starred) - Number(a.starred))
    .map((r) => ({ label: r.starred ? '★ Key' : '•', value: r.headline, starred: r.starred }))
}

/** A short label for a column, first clause before "(" or "?", capped. */
function chipLabel(label: string): string {
  const head = label.replace('{genre}', 'the genre').split(/[(?]/)[0].trim()
  return head.length > 24 ? `${head.slice(0, 23)}…` : head || label
}

/** A compact label for a prompt: first clause before "(" or "?", genre token stripped. */
function promptLabel(node: GuideNode): string {
  const head = node.label.replace('{genre}', 'the genre').split(/[(?]/)[0].trim()
  return head.length > 60 ? `${head.slice(0, 59)}…` : head
}

/**
 * The 2c big-picture decisions, grouped by area: each row's "idea for the
 * translation" (the last column of every macro table), headed by the row's own
 * headline. Feeds the 2e decisions summary.
 */
export interface DecisionGroup {
  group: string
  fields: SummaryField[]
}

export function macroDecisions(entries: Entry[], worksheetId: string): DecisionGroup[] {
  const groupNode = findNode('s0.macro_notes')?.node
  const out: DecisionGroup[] = []
  for (const area of groupNode?.children ?? []) {
    const cols = area.columns ?? []
    if (cols.length < 2) continue
    // The translation idea is the column tagged zone 'translation' (the yellow
    // field on 2c); fall back to the last column for any table not yet tagged.
    const ideaCol = cols.find((c) => c.zone === 'translation') ?? cols[cols.length - 1]
    const headCol = cols.find((c) => c.zone !== 'translation') ?? cols[0]
    const rowIds =
      area.type === 'fixed_grid'
        ? (area.rows ?? []).map((r) => ({ id: r.id, label: r.label }))
        : parseIdArray(
            entries.find(
              (e) => e.node_id === area.id && e.worksheet_id === worksheetId && e.cell_key === ROWS_KEY,
            )?.value,
          ).map((id) => ({ id, label: '' }))
    const fields: SummaryField[] = []
    for (const row of rowIds) {
      const idea = trimmed(
        entries.find(
          (e) =>
            e.node_id === area.id &&
            e.worksheet_id === worksheetId &&
            e.cell_key === `${row.id}__${ideaCol.id}`,
        )?.text,
      )
      if (!idea) continue
      const head =
        row.label ||
        trimmed(
          entries.find(
            (e) =>
              e.node_id === area.id &&
              e.worksheet_id === worksheetId &&
              e.cell_key === `${row.id}__${headCol.id}`,
          )?.text,
        ) ||
        '•'
      fields.push({ label: head, value: idea })
    }
    if (fields.length) out.push({ group: promptLabel(area), fields })
  }
  return out
}

/**
 * The drafting-step recap (#23): the psalm purpose, the chosen genre, and the
 * stylistic priorities the team starred, so everything identified is in view
 * while writing the translation.
 */
export interface TranslationSummary {
  purpose: SummaryField[]
  chosenGenre: string
  priorities: SummaryField[]
}

const SN_GROUPS: Array<[string, string]> = [
  ['s0.sn.words', 'Words'],
  ['s0.sn.discourse', 'How it is put together'],
  ['s0.sn.sounds', 'Sounds'],
  ['s0.sn.figurative', 'Picture-language'],
  ['s0.sn.performance', 'Performance'],
  ['s0.sn.additional', 'Other'],
]

export function translationSummary(
  entries: Entry[],
  focusTextId: string,
  worksheetId: string,
): TranslationSummary {
  const inFocus = (e: Entry) => e.focus_text_id === focusTextId
  const purposeSpecific = trimmed(
    entries.find((e) => e.node_id === 's0.purpose.specific' && !e.cell_key && inFocus(e))?.text,
  )
  const purposeGeneral = trimmed(
    entries.find((e) => e.node_id === 's0.purpose.general' && !e.cell_key && inFocus(e))?.text,
  )
  const broad = entries.find((e) => e.node_id === 's0.purpose.broad_genre' && !e.cell_key && inFocus(e))?.value
  const broadNode = findNode('s0.purpose.broad_genre')?.node
  const purpose: SummaryField[] = [
    { label: 'What it is about', value: purposeSpecific },
    { label: 'What it is doing', value: purposeGeneral },
    { label: 'Kind of passage', value: broad ? optionLabel(broadNode?.options, broad) : '' },
  ].filter((f) => f.value)

  const chosenGenre = trimmed(
    entries.find((e) => e.node_id === 's0.genre_choice.chosen' && !e.cell_key && e.worksheet_id === worksheetId)
      ?.text,
  )

  const priorities: SummaryField[] = []
  for (const [nodeId, label] of SN_GROUPS) {
    const order = parseIdArray(
      entries.find((e) => e.node_id === nodeId && e.worksheet_id === worksheetId && e.cell_key === ROWS_KEY)
        ?.value,
    )
    for (const rowId of order) {
      const starred =
        entries.find((e) => e.node_id === nodeId && e.worksheet_id === worksheetId && e.cell_key === rowId)
          ?.is_priority === true
      if (!starred) continue
      const feature = trimmed(
        entries.find(
          (e) => e.node_id === nodeId && e.worksheet_id === worksheetId && e.cell_key === `${rowId}__feature`,
        )?.text,
      )
      const idea = trimmed(
        entries.find(
          (e) => e.node_id === nodeId && e.worksheet_id === worksheetId && e.cell_key === `${rowId}__idea`,
        )?.text,
      )
      if (feature || idea) {
        priorities.push({ label, value: idea ? `${feature} → ${idea}` : feature })
      }
    }
  }

  return { purpose, chosenGenre, priorities }
}
