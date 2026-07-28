/**
 * PDF renderer for the findings report, using pdfmake's declarative document
 * model (it handles pagination, headings, and tables for us). Consumes the same
 * `ReportModel` and `style` tokens as the Word renderer so the two look like one
 * family. This module is loaded lazily by the Export view, so pdfmake and its
 * ~1.9 MB embedded-font virtual file system stay out of the main bundle.
 */
import * as pdfMakeNs from 'pdfmake/build/pdfmake'
import pdfVfs from 'pdfmake/build/vfs_fonts'
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import type { ReportModel, ReportQuestion } from './model'
import {
  COLORS,
  FOOTER_LABEL,
  NA_LABEL,
  REPORT_TITLE,
  SIZES,
  hash,
} from './style'

interface PdfMake {
  createPdf(def: TDocumentDefinitions): { getBlob(cb: (blob: Blob) => void): void }
  addVirtualFileSystem(vfs: unknown): void
}

const pdfMake = (((pdfMakeNs as unknown as { default?: PdfMake }).default ?? pdfMakeNs) as unknown) as PdfMake

let vfsReady = false
function ensureFonts(): void {
  if (vfsReady) return
  pdfMake.addVirtualFileSystem(pdfVfs)
  vfsReady = true
}

const CONTENT_WIDTH = 515 // letter width minus default 40pt side margins

function distinct(items: string[]): string[] {
  return items.filter((v, i, a) => a.indexOf(v) === i)
}

const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => hash(COLORS.rule),
  vLineColor: () => hash(COLORS.rule),
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 6,
  paddingRight: () => 6,
}

/**
 * A table cell. When a paired-language gloss exists it is stacked beneath the
 * value inside the same cell, so columns stay aligned and the table does not
 * double in width.
 */
function answerCell(answer: string, alt?: string): Content {
  if (!alt?.trim()) return { text: answer, style: 'tableCell' }
  return { stack: [{ text: answer, style: 'tableCell' }, { text: alt, style: 'altAnswer' }] }
}

function gridContent(q: ReportQuestion): Content[] {
  const label: Content = { text: q.question, style: 'question', margin: [0, 6, 0, 3] }
  const altLabel: Content | null = q.questionAlt?.trim()
    ? { text: q.questionAlt, style: 'altQuestion', margin: [0, 0, 0, 3] }
    : null

  let widths: (string | number)[]
  const body: Content[][] = []
  if (q.columns.length > 0) {
    widths = ['auto', ...q.columns.map(() => '*')]
    body.push([
      { text: '', style: 'tableHeader' },
      ...q.columns.map((c): Content => ({ text: c, style: 'tableHeader' })),
    ])
    for (const rl of distinct(q.cells.map((c) => c.row))) {
      body.push([
        { text: rl, style: 'tableRowHead' },
        ...q.columns.map((col): Content => {
          const match = q.cells.find((c) => c.row === rl && c.column === col)
          return answerCell(match?.answer ?? '', match?.answerAlt)
        }),
      ])
    }
  } else {
    widths = ['auto', '*']
    body.push([
      { text: '#', style: 'tableRowHead' },
      { text: 'Answer', style: 'tableHeader' },
    ])
    for (const c of q.cells) {
      body.push([{ text: c.row || '•', style: 'tableRowHead' }, answerCell(c.answer, c.answerAlt)])
    }
  }

  return [
    label,
    ...(altLabel ? [altLabel] : []),
    { table: { headerRows: 1, widths, body }, layout: tableLayout, margin: [0, 0, 0, 4] },
  ]
}

function scalarContent(q: ReportQuestion): Content[] {
  const cell = q.cells[0]
  const label: Content = { text: q.question, style: 'question', margin: [0, 6, 0, 1] }
  const altLabel: Content[] = q.questionAlt?.trim()
    ? [{ text: q.questionAlt, style: 'altQuestion' }]
    : []
  if (cell?.notApplicable && !cell.answer.trim()) {
    return [label, ...altLabel, { text: NA_LABEL, style: 'na' }]
  }
  const altAnswer: Content[] = cell?.answerAlt?.trim()
    ? [{ text: cell.answerAlt, style: 'altAnswer' }]
    : []
  return [label, ...altLabel, { text: [{ text: cell?.answer ?? '', style: 'answer' }] }, ...altAnswer]
}

export function buildPdf(model: ReportModel): Promise<Blob> {
  ensureFonts()

  const content: Content[] = [
    { text: model.title, style: 'title' },
    {
      text: [
        { text: model.focusText, style: 'focusText' },
        { text: '  ×  ', color: hash(COLORS.question), fontSize: SIZES.subtitle },
        { text: model.genre, style: 'genre' },
      ],
      margin: [0, 2, 0, 3],
    },
    {
      text: `${model.mode} depth  ·  ${model.date}  ·  ${model.answeredCount} answered item${model.answeredCount === 1 ? '' : 's'}`,
      style: 'meta',
    },
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.75, lineColor: hash(COLORS.rule) }],
      margin: [0, 6, 0, 10],
    },
  ]

  for (const section of model.sections) {
    content.push({ text: section.title, style: 'section' })
    for (const sub of section.subsections) {
      if (sub.title && sub.title !== section.title) {
        content.push({ text: sub.title, style: 'subsection' })
      }
      for (const q of sub.questions) {
        content.push(...(q.isGrid ? gridContent(q) : scalarContent(q)))
      }
    }
  }

  const docDefinition: TDocumentDefinitions = {
    info: { title: `${REPORT_TITLE} — ${model.focusText} × ${model.genre}` },
    pageMargins: [40, 44, 40, 48],
    content,
    footer: (currentPage: number, pageCount: number): Content => ({
      text: `${FOOTER_LABEL}  ·  Page ${currentPage} of ${pageCount}`,
      style: 'footer',
      alignment: 'center',
      margin: [0, 12, 0, 0],
    }),
    defaultStyle: { font: 'Roboto', fontSize: SIZES.answer, color: hash(COLORS.answer) },
    styles: {
      title: { fontSize: SIZES.title, bold: true, color: hash(COLORS.slate), margin: [0, 0, 0, 2] },
      focusText: { fontSize: SIZES.subtitle, bold: true, color: hash(COLORS.sky) },
      genre: { fontSize: SIZES.subtitle, bold: true, color: hash(COLORS.emerald) },
      meta: { fontSize: SIZES.meta, color: hash(COLORS.question) },
      section: { fontSize: SIZES.section, bold: true, color: hash(COLORS.slate), margin: [0, 14, 0, 4] },
      subsection: { fontSize: SIZES.subsection, bold: true, color: hash(COLORS.sky), margin: [0, 8, 0, 3] },
      question: { fontSize: SIZES.question, color: hash(COLORS.question) },
      answer: { fontSize: SIZES.answer, color: hash(COLORS.answer) },
      na: { fontSize: SIZES.na, italics: true, color: hash(COLORS.na) },
      tableHeader: { fontSize: SIZES.tableHeader, bold: true, color: hash(COLORS.sky) },
      tableRowHead: { fontSize: SIZES.tableHeader, bold: true, color: hash(COLORS.question) },
      tableCell: { fontSize: SIZES.tableCell, color: hash(COLORS.answer) },
      // Bilingual gloss: italic and subordinate, so the team's own words keep
      // primacy and the second language reads as a reviewer's aid.
      altQuestion: { fontSize: SIZES.altQuestion, italics: true, color: hash(COLORS.alt) },
      altAnswer: { fontSize: SIZES.altAnswer, italics: true, color: hash(COLORS.alt) },
      footer: { fontSize: SIZES.footer, color: hash(COLORS.footer) },
    },
  }

  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob) => resolve(blob))
  })
}
