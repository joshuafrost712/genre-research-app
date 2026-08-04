/**
 * Offline export: a long/tidy CSV (one row per non-empty cell) and a generated
 * AI-synthesis prompt the team pastes into Claude with the CSV. Both derive from
 * schema + entries and need no account or connectivity. Google Sheets export
 * (client-side GIS, tab-per-section) is deferred: it needs an OAuth client id.
 */
import { findNode, findSourceNode } from './content/loader'
import { entryTranslation, ROWS_KEY } from './storage/entries'
import { DEFER_TO_DRAFTING, STYLE_IDEA_NODE, SUMMARY_KEY } from './content/summarize'
import { localizedNode } from './i18n/content'
import type { Locale } from './i18n/locales'
import type { Entry } from './types'
import type { GuideNode, Layer } from '../schema/types'

/**
 * Pair every question and answer with a second language.
 *
 * The point is review: a consultant who does not read the team's working language
 * must still be able to check the work, and the team must still see the record in
 * their own. `answer` always stays the team's own words; the translation goes in
 * the alt column, never over the top of what they said.
 */
export interface BilingualOptions {
  altLocale: Locale
}

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
  notApplicable: string
  /** The same question in the paired language (bilingual export only). */
  questionAlt?: string
  /** The answer translated into the paired language, when a translation exists. */
  answerAlt?: string
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
/** The same worksheet question rendered in another language. */
function questionInLocale(nodeId: string, locale: Locale): string | undefined {
  const source = findSourceNode(nodeId)?.node
  return source ? localizedNode(source, locale).label : undefined
}

export function buildRows(
  entries: Entry[],
  names: ExportNames,
  bilingual?: BilingualOptions,
): ExportRow[] {
  // Row order per (node, container) from the ROWS sidecars.
  const rowOrder = new Map<string, string[]>()
  for (const e of entries) {
    if (e.cell_key === ROWS_KEY) {
      rowOrder.set(`${e.node_id}|${containerIdOf(e)}`, parseArray(e.value))
    }
  }

  const rows: ExportRow[] = []
  for (const e of entries) {
    if (e.cell_key === ROWS_KEY) continue

    // 2d plans live on a synthetic node (one per Required feature); export them
    // with the feature they answer, looked up from the genre-layer table row.
    if (e.node_id === STYLE_IDEA_NODE) {
      // A feature flagged "best decided while drafting" exports even without
      // plan text; the flag itself is the decision of record.
      const deferredPlan = e.value === DEFER_TO_DRAFTING
      const text = e.text?.trim() ?? ''
      if (!text && !deferredPlan) continue
      const sep = e.cell_key?.indexOf('__') ?? -1
      const tableId = sep > 0 ? e.cell_key!.slice(0, sep) : ''
      const rowId = sep > 0 ? e.cell_key!.slice(sep + 2) : ''
      const feature =
        entries.find((x) => x.node_id === tableId && x.cell_key === `${rowId}__feature`)?.text ?? ''
      rows.push({
        section: findNode('s0')?.node.label ?? 'Create / Translate',
        subsection: findNode('s0.stylistic_notes')?.node.label ?? '2d: The Style — Compare & Decide',
        nodeId: e.node_id,
        question: feature ? `Plan for: ${feature}` : 'Plan for a Required feature',
        layer: 'synthesis',
        container: containerLabel(e, names),
        row: '',
        column: '',
        answer: deferredPlan
          ? text
            ? `To be decided while drafting — notes so far: ${text}`
            : 'To be decided while drafting'
          : text,
        notApplicable: '',
      })
      continue
    }

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
    const col =
      e.cell_key === SUMMARY_KEY
        ? 'Table summary'
        : colId
          ? (node.columns?.find((c) => c.id === colId)?.label ?? colId)
          : ''

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
      notApplicable: na ? 'yes' : '',
      ...(bilingual
        ? {
            questionAlt: questionInLocale(e.node_id, bilingual.altLocale),
            // Only the free-text answer has a translation; a select's value is an
            // id whose label already comes from the translated worksheet content.
            answerAlt: entryTranslation(e, bilingual.altLocale),
          }
        : {}),
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

// Human-relevant columns lead; the technical/id columns trail. A CSV can't be
// styled, but a legible column order (and a BOM so Excel opens Greek/diacritics
// correctly) is the most people-friendly a CSV gets.
const CSV_HEADERS: [keyof ExportRow, string][] = [
  ['section', 'Section'],
  ['subsection', 'Subsection'],
  ['question', 'Question'],
  ['answer', 'Answer'],
  ['notApplicable', 'Not applicable'],
  ['layer', 'Layer'],
  ['container', 'Container'],
  ['row', 'Row'],
  ['column', 'Column'],
  ['nodeId', 'Node ID'],
]

// UTF-8 byte-order mark: makes Excel decode the file as UTF-8 so non-ASCII
// (Greek, diacritics, curly quotes) renders instead of mojibake.
const BOM = '﻿'

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Bilingual columns sit beside the ones they pair with, so a reviewer reads the
 * two versions of a question (or an answer) side by side rather than scrolling.
 * Only emitted when the rows actually carry them, so a monolingual export keeps
 * exactly the columns it always had.
 */
function csvHeadersFor(rows: ExportRow[]): [keyof ExportRow, string][] {
  const hasQuestionAlt = rows.some((r) => r.questionAlt !== undefined)
  const hasAnswerAlt = rows.some((r) => r.answerAlt !== undefined)
  if (!hasQuestionAlt && !hasAnswerAlt) return CSV_HEADERS

  const out: [keyof ExportRow, string][] = []
  for (const entry of CSV_HEADERS) {
    out.push(entry)
    if (entry[0] === 'question' && hasQuestionAlt) out.push(['questionAlt', 'Question (other language)'])
    if (entry[0] === 'answer' && hasAnswerAlt) out.push(['answerAlt', 'Answer (other language)'])
  }
  return out
}

export function toCsv(rows: ExportRow[]): string {
  const headers = csvHeadersFor(rows)
  const header = headers.map(([, label]) => label).join(',')
  // The bilingual columns are optional on ExportRow; an absent value is an empty
  // cell, not the string "undefined".
  const body = rows.map((r) => headers.map(([key]) => csvField(r[key] ?? '')).join(','))
  return BOM + [header, ...body].join('\n')
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
 * Workbook tabs reproducing Katie's worksheet layout: one tab per section. Pure,
 * so it is testable and shared by the Google Sheets export.
 */
export function buildSheetTabs(rows: ExportRow[], names: ExportNames): SheetTab[] {
  const header = ['Subsection', 'Question', 'Row', 'Column', 'Answer', 'Not applicable']
  const sections = dedupe(rows.map((r) => r.section)).sort()

  const tabs: SheetTab[] = sections.map((section) => ({
    title: sheetTitle(section),
    values: [
      [section],
      [`${names.focusText} × ${names.genre}`],
      header,
      ...rows
        .filter((r) => r.section === section)
        .map((r) => [r.subsection, r.question, r.row, r.column, r.answer, r.notApplicable]),
    ],
  }))

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
    lines.push(`- ${r.question}${where ? ` (${where})` : ''}: ${r.answer}`)
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
