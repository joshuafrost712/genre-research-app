/**
 * Offline export: a long/tidy CSV (one row per non-empty cell) and a generated
 * AI-synthesis prompt the team pastes into Claude with the CSV. Both derive from
 * schema + entries and need no account or connectivity. Google Sheets export
 * (client-side GIS, tab-per-section) is deferred: it needs an OAuth client id.
 */
import { findNode } from './content/loader'
import { ROWS_KEY } from './storage/entries'
import type { Entry } from './types'
import type { GuideNode, Layer } from '../schema/types'

export interface ExportNames {
  focusText: string
  genre: string
  mode: string
}

export interface ExportRow {
  section: string
  subsection: string
  nodeId: string
  question: string
  layer: string
  container: string
  row: string
  column: string
  answer: string
  priority: string
  notApplicable: string
}

function containerIdOf(e: Entry): string {
  return e.genre_id ?? e.focus_text_id ?? e.worksheet_id ?? ''
}

function layerOf(e: Entry): Layer {
  if (e.genre_id) return 'genre'
  if (e.focus_text_id) return 'focusText'
  return 'synthesis'
}

function containerLabel(e: Entry, names: ExportNames): string {
  if (e.genre_id) return names.genre
  if (e.focus_text_id) return names.focusText
  return `${names.focusText} × ${names.genre}`
}

function optionLabel(options: { id: string; label: string }[] | undefined, value: string): string {
  return options?.find((o) => o.id === value)?.label ?? value
}

/** Resolve an entry's answer to display text, given its node and optional column. */
function answerText(node: GuideNode, e: Entry, colId?: string): string {
  if (colId) {
    const col = node.columns?.find((c) => c.id === colId)
    if (col?.cellType === 'single_select') return optionLabel(col.options, e.value ?? '')
    if (col?.cellType === 'multi_select') return parseArray(e.value).map((v) => optionLabel(col.options, v)).join(', ')
    return e.text ?? ''
  }
  if (node.type === 'single_select' || node.type === 'three_point_scale') {
    return e.value ? optionLabel(node.options, e.value) : ''
  }
  if (node.type === 'multi_select') {
    return parseArray(e.value).map((v) => optionLabel(node.options, v)).join(', ')
  }
  return e.text ?? ''
}

function parseArray(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

/** Build the long-format rows from the entries of one project. */
export function buildRows(entries: Entry[], names: ExportNames): ExportRow[] {
  // Row order per (node, container) from the ROWS sidecars, plus the priority set.
  const rowOrder = new Map<string, string[]>()
  const prioritized = new Set<string>()
  for (const e of entries) {
    if (e.cell_key === ROWS_KEY) {
      rowOrder.set(`${e.node_id}|${containerIdOf(e)}`, parseArray(e.value))
    }
    if (e.is_priority && e.cell_key) prioritized.add(e.cell_key)
  }

  const rows: ExportRow[] = []
  for (const e of entries) {
    if (e.cell_key === ROWS_KEY) continue
    const ref = findNode(e.node_id)
    if (!ref) continue
    const { node, parents } = ref

    const [rowId, colId] = e.cell_key ? splitCell(e.cell_key) : [undefined, undefined]
    const answer = answerText(node, e, colId)
    const na = !!e.is_not_applicable

    // Emit if there is content or it is an explicit not-applicable decision.
    if (!answer.trim() && !na) continue

    let rowLabel = ''
    if (rowId) {
      const order = rowOrder.get(`${e.node_id}|${containerIdOf(e)}`) ?? []
      const idx = order.indexOf(rowId)
      rowLabel = idx >= 0 ? String(idx + 1) : ''
    }
    const col = colId ? (node.columns?.find((c) => c.id === colId)?.label ?? colId) : ''
    const isPriority = (rowId && prioritized.has(rowId)) || e.is_priority

    rows.push({
      section: parents[0]?.label ?? '',
      subsection: parents.at(-1)?.label ?? '',
      nodeId: e.node_id,
      question: node.label,
      layer: layerOf(e),
      container: containerLabel(e, names),
      row: rowLabel,
      column: col,
      answer,
      priority: isPriority ? 'yes' : '',
      notApplicable: na ? 'yes' : '',
    })
  }

  // Stable order: by section, then subsection, then question, then row.
  return rows.sort(
    (a, b) =>
      a.section.localeCompare(b.section) ||
      a.subsection.localeCompare(b.subsection) ||
      a.question.localeCompare(b.question) ||
      a.row.localeCompare(b.row, undefined, { numeric: true }),
  )
}

function splitCell(cellKey: string): [string, string | undefined] {
  const i = cellKey.indexOf('__')
  return i === -1 ? [cellKey, undefined] : [cellKey.slice(0, i), cellKey.slice(i + 2)]
}

const CSV_HEADERS: [keyof ExportRow, string][] = [
  ['section', 'Section'],
  ['subsection', 'Subsection'],
  ['nodeId', 'Node ID'],
  ['question', 'Question'],
  ['layer', 'Layer'],
  ['container', 'Container'],
  ['row', 'Row'],
  ['column', 'Column'],
  ['answer', 'Answer'],
  ['priority', 'Priority'],
  ['notApplicable', 'Not applicable'],
]

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(rows: ExportRow[]): string {
  const header = CSV_HEADERS.map(([, label]) => label).join(',')
  const body = rows.map((r) => CSV_HEADERS.map(([key]) => csvField(r[key])).join(','))
  return [header, ...body].join('\n')
}

export interface SheetTab {
  title: string
  values: string[][]
}

/** Sheet name constraints: <=31 chars, no []*?/\ and no leading/trailing quote. */
function sheetTitle(label: string): string {
  return label.replace(/[[\]*?/\\]/g, ' ').replace(/^'|'$/g, '').trim().slice(0, 31) || 'Sheet'
}

/**
 * Workbook tabs reproducing Katie's worksheet layout: one tab per section plus a
 * Priorities tab. Pure, so it is testable and shared by the Google Sheets export.
 */
export function buildSheetTabs(rows: ExportRow[], names: ExportNames): SheetTab[] {
  const header = ['Subsection', 'Question', 'Row', 'Column', 'Answer', 'Priority', 'Not applicable']
  const sections = dedupe(rows.map((r) => r.section)).sort()

  const tabs: SheetTab[] = sections.map((section) => ({
    title: sheetTitle(section),
    values: [
      [section],
      [`${names.focusText} × ${names.genre}`],
      header,
      ...rows
        .filter((r) => r.section === section)
        .map((r) => [r.subsection, r.question, r.row, r.column, r.answer, r.priority, r.notApplicable]),
    ],
  }))

  const starred = rows.filter((r) => r.priority === 'yes')
  if (starred.length) {
    tabs.push({
      title: 'Priorities',
      values: [
        ['Section', 'Subsection', 'Question', 'Answer'],
        ...starred.map((r) => [r.section, r.subsection, r.question, r.answer]),
      ],
    })
  }
  return tabs
}

/** A prompt the team pastes into Claude alongside the CSV. */
export function buildAiPrompt(rows: ExportRow[], names: ExportNames): string {
  const na = rows.filter((r) => r.notApplicable === 'yes').map((r) => r.question)
  const answered = rows.filter((r) => r.notApplicable !== 'yes' && r.answer.trim())

  const lines: string[] = []
  lines.push(
    'You are helping a Bible translation team translate a focus text into a culturally relevant local artistic genre.',
    'They have studied the genre and the focus text using a structured worksheet. Below is their work.',
    '',
    `Focus text: ${names.focusText}`,
    `Genre under analysis: ${names.genre}`,
    `Depth mode: ${names.mode}`,
    '',
  )

  if (na.length) {
    lines.push(
      'These items were intentionally marked NOT APPLICABLE. Do not flag them as gaps:',
      ...dedupe(na).map((q) => `- ${q}`),
      '',
    )
  }

  lines.push('Their findings so far:')
  let currentSub = ''
  for (const r of answered) {
    const sub = `${r.section} — ${r.subsection}`
    if (sub !== currentSub) {
      lines.push('', `## ${sub}`)
      currentSub = sub
    }
    const where = [r.row && `row ${r.row}`, r.column].filter(Boolean).join(', ')
    const star = r.priority === 'yes' ? ' [PRIORITY]' : ''
    lines.push(`- ${r.question}${where ? ` (${where})` : ''}: ${r.answer}${star}`)
  }

  lines.push(
    '',
    'Please provide:',
    '1. Concrete recommendations for translating this focus text into this genre, weighting the items marked [PRIORITY].',
    '2. Only the real gaps worth filling next (exclude anything marked not applicable above).',
    '3. The top 3 decisions the team should make next.',
    'Pose anything uncertain as a question for the team to decide; do not decide for them.',
  )

  return lines.join('\n')
}

function dedupe(items: string[]): string[] {
  return items.filter((v, i, a) => a.indexOf(v) === i)
}
