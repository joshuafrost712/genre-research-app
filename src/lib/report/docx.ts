/**
 * Word (.docx) renderer for the findings report. Consumes the shared
 * `ReportModel` and the shared `style` tokens so it stays visually in sync with
 * the PDF renderer. Loaded lazily by the Export view (the `docx` library is only
 * pulled in when the user actually exports Word).
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { ReportModel, ReportQuestion } from './model'
import {
  COLORS,
  FOOTER_LABEL,
  NA_LABEL,
  PRIORITY_BADGE,
  SIZES,
  halfPt,
} from './style'

function heading(text: string, size: number, color: string, opts: { before?: number } = {}): Paragraph {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: 60 },
    children: [new TextRun({ text, bold: true, size: halfPt(size), color })],
  })
}

function badgeRun(): TextRun {
  return new TextRun({ text: `  ${PRIORITY_BADGE}`, bold: true, size: halfPt(SIZES.badge), color: COLORS.amber })
}

/** A scalar (non-grid) question: muted question label, then the emphasized answer. */
function scalarParas(q: ReportQuestion): Paragraph[] {
  const cell = q.cells[0]
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: 120, after: 20 },
      children: [new TextRun({ text: q.question, size: halfPt(SIZES.question), color: COLORS.question })],
    }),
  ]
  if (cell?.notApplicable && !cell.answer.trim()) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: NA_LABEL, italics: true, size: halfPt(SIZES.na), color: COLORS.na })],
      }),
    )
  } else {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: cell?.answer ?? '', size: halfPt(SIZES.answer), color: COLORS.answer }),
          ...(cell?.priority ? [badgeRun()] : []),
        ],
      }),
    )
  }
  return out
}

function cellText(text: string, opts: { bold?: boolean; color?: string; size?: number; priority?: boolean } = {}): TableCell {
  return new TableCell({
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: opts.bold,
            size: halfPt(opts.size ?? SIZES.tableCell),
            color: opts.color ?? COLORS.answer,
          }),
          ...(opts.priority ? [badgeRun()] : []),
        ],
      }),
    ],
  })
}

/** A grid/table question rendered as a bordered table. */
function gridParas(q: ReportQuestion): (Paragraph | Table)[] {
  const label = new Paragraph({
    spacing: { before: 120, after: 40 },
    children: [new TextRun({ text: q.question, size: halfPt(SIZES.question), color: COLORS.question })],
  })

  const border = { style: BorderStyle.SINGLE, size: 2, color: COLORS.rule }
  const borders = { top: border, bottom: border, left: border, right: border }
  const rows: TableRow[] = []

  if (q.columns.length > 0) {
    const rowLabels = distinct(q.cells.map((c) => c.row))
    rows.push(
      new TableRow({
        tableHeader: true,
        children: [
          cellText('', { color: COLORS.question, size: SIZES.tableHeader }),
          ...q.columns.map((c) => cellText(c, { bold: true, color: COLORS.sky, size: SIZES.tableHeader })),
        ],
      }),
    )
    for (const rl of rowLabels) {
      rows.push(
        new TableRow({
          children: [
            cellText(rl, { bold: true, color: COLORS.question, size: SIZES.tableHeader }),
            ...q.columns.map((col) => {
              const match = q.cells.find((c) => c.row === rl && c.column === col)
              return cellText(match?.answer ?? '', { priority: match?.priority })
            }),
          ],
        }),
      )
    }
  } else {
    rows.push(
      new TableRow({
        tableHeader: true,
        children: [
          cellText('#', { bold: true, color: COLORS.question, size: SIZES.tableHeader }),
          cellText('Answer', { bold: true, color: COLORS.sky, size: SIZES.tableHeader }),
        ],
      }),
    )
    for (const c of q.cells) {
      rows.push(
        new TableRow({
          children: [cellText(c.row || '•', { bold: true, color: COLORS.question }), cellText(c.answer, { priority: c.priority })],
        }),
      )
    }
  }

  return [label, new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows })]
}

function distinct(items: string[]): string[] {
  return items.filter((v, i, a) => a.indexOf(v) === i)
}

export async function buildDocx(model: ReportModel): Promise<Blob> {
  const children: (Paragraph | Table)[] = []

  // Title block.
  children.push(
    new Paragraph({
      children: [new TextRun({ text: model.title, bold: true, size: halfPt(SIZES.title), color: COLORS.slate })],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: model.focusText, bold: true, size: halfPt(SIZES.subtitle), color: COLORS.sky }),
        new TextRun({ text: '  ×  ', size: halfPt(SIZES.subtitle), color: COLORS.question }),
        new TextRun({ text: model.genre, bold: true, size: halfPt(SIZES.subtitle), color: COLORS.emerald }),
      ],
    }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.rule, space: 4 } },
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `${model.mode} depth  ·  ${model.date}  ·  ${model.answeredCount} answered item${model.answeredCount === 1 ? '' : 's'}`,
          size: halfPt(SIZES.meta),
          color: COLORS.question,
        }),
      ],
    }),
  )

  // Priorities roll-up.
  if (model.priorities.length) {
    children.push(heading('Priorities', SIZES.section, COLORS.amber, { before: 120 }))
    for (const p of model.priorities) {
      children.push(
        new Paragraph({
          spacing: { after: 20 },
          children: [
            new TextRun({ text: `${p.section} — ${p.subsection}: `, size: halfPt(SIZES.question), color: COLORS.question }),
            new TextRun({ text: p.answer, size: halfPt(SIZES.answer), color: COLORS.answer }),
          ],
        }),
      )
    }
  }

  // Body: sections -> subsections -> questions.
  for (const section of model.sections) {
    children.push(heading(section.title, SIZES.section, COLORS.slate, { before: 280 }))
    for (const sub of section.subsections) {
      if (sub.title && sub.title !== section.title) {
        children.push(heading(sub.title, SIZES.subsection, COLORS.sky, { before: 160 }))
      }
      for (const q of sub.questions) {
        children.push(...(q.isGrid ? gridParas(q) : scalarParas(q)))
      }
    }
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [
      {
        properties: {},
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${FOOTER_LABEL}  ·  Page `, size: halfPt(SIZES.footer), color: COLORS.footer }),
                  new TextRun({ children: [PageNumber.CURRENT], size: halfPt(SIZES.footer), color: COLORS.footer }),
                  new TextRun({ text: ' of ', size: halfPt(SIZES.footer), color: COLORS.footer }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: halfPt(SIZES.footer), color: COLORS.footer }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  return Packer.toBlob(doc)
}
