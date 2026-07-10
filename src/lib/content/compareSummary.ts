/**
 * Pure helpers that condense stored answers into the psalm-side and genre-side
 * summaries shown on the compare page. They operate over a plain `Entry[]` (the
 * project's entries, read once) so the page does a single query and stays
 * testable without IndexedDB. Select values are resolved to their human labels
 * through the content tree (`findNode`), so a re-worded option never leaks an
 * option id into the UI.
 */
import { findNode } from './loader'
import type { Entry } from '../types'
import type { SelectOption } from '../../schema/types'

export interface SummaryField {
  label: string
  value: string
}

const ROWS_KEY = '__rows'

/** Scalar block entry (cell_key undefined) for a node within one container. */
function scalarEntry(
  entries: Entry[],
  nodeId: string,
  match: (e: Entry) => boolean,
): Entry | undefined {
  return entries.find((e) => e.node_id === nodeId && !e.cell_key && match(e))
}

function trimmed(s: string | undefined): string {
  return (s ?? '').trim()
}

function optionLabel(options: SelectOption[] | undefined, value: string): string {
  return options?.find((o) => o.id === value)?.label ?? value
}

/** A field, only if it has content; keeps empty answers out of the summary. */
function field(label: string, value: string): SummaryField | null {
  const v = trimmed(value)
  return v ? { label, value: v } : null
}

// --- psalm side (focusText layer) -----------------------------------------

/**
 * The psalm's identity, for the Matching lens: what it is about, what it is
 * doing, what kind it is, and how it will be used. `reference` comes from the
 * FocusText record (the genre/psalm bank names it), the rest from s0.purpose.
 */
export function psalmIdentity(entries: Entry[], focusTextId: string): SummaryField[] {
  const inFocus = (e: Entry) => e.focus_text_id === focusTextId
  const broad = scalarEntry(entries, 's0.purpose.broad_genre', inFocus)
  const broadNode = findNode('s0.purpose.broad_genre')?.node
  return [
    field('What it is mainly about', trimmed(scalarEntry(entries, 's0.purpose.specific', inFocus)?.text)),
    field('What it is mainly doing', trimmed(scalarEntry(entries, 's0.purpose.general', inFocus)?.text)),
    field('Kind of psalm', broad?.value ? optionLabel(broadNode?.options, broad.value) : ''),
    field('How it will be used', trimmed(scalarEntry(entries, 's0.purpose.intended_use', inFocus)?.text)),
  ].filter((f): f is SummaryField => f !== null)
}

/**
 * A compact psalm reminder for the big-picture and words lenses, where the app
 * captures no psalm-specific focusText data: keep the psalm in view (what kind
 * it is and what it is doing) while the translator reads the genre's conventions
 * and writes the bridge in the middle box.
 */
export function psalmReminder(entries: Entry[], focusTextId: string): SummaryField[] {
  const inFocus = (e: Entry) => e.focus_text_id === focusTextId
  const broad = scalarEntry(entries, 's0.purpose.broad_genre', inFocus)
  const broadNode = findNode('s0.purpose.broad_genre')?.node
  return [
    field('Kind of psalm', broad?.value ? optionLabel(broadNode?.options, broad.value) : ''),
    field('What it is mainly doing', trimmed(scalarEntry(entries, 's0.purpose.general', inFocus)?.text)),
  ].filter((f): f is SummaryField => f !== null)
}

// --- genre side (genre layer) ---------------------------------------------

/** The genre's identity (1B), for the Matching lens. */
export function genreIdentity(entries: Entry[], genreId: string): SummaryField[] {
  const inGenre = (e: Entry) => e.genre_id === genreId
  const vit = scalarEntry(entries, 's1b.vitality', inGenre)
  const vitNode = findNode('s1b.vitality')?.node
  return [
    field('Name meaning', trimmed(scalarEntry(entries, 's1b.name_meaning', inGenre)?.text)),
    field('What it is about', trimmed(scalarEntry(entries, 's1b.content', inGenre)?.text)),
    field('What it reminds people of', trimmed(scalarEntry(entries, 's1b.associations', inGenre)?.text)),
    field('Still alive?', vit?.value ? optionLabel(vitNode?.options, vit.value) : ''),
  ].filter((f): f is SummaryField => f !== null)
}

/**
 * How the genre links related ideas (2E, the s2d.chart grid). One field per grid
 * row that has any filled cell; the value joins the filled channels as
 * "channel — text". Row and column labels come from the content definition.
 */
export function genreLinking(entries: Entry[], genreId: string): SummaryField[] {
  const node = findNode('s2d.chart')?.node
  if (!node?.rows || !node.columns) return []
  const out: SummaryField[] = []
  for (const row of node.rows) {
    const parts: string[] = []
    for (const col of node.columns) {
      const cell = entries.find(
        (e) => e.node_id === 's2d.chart' && e.genre_id === genreId && e.cell_key === `${row.id}__${col.id}`,
      )
      const text = trimmed(cell?.text)
      if (text) parts.push(`${shortLabel(col.label)} — ${text}`)
    }
    if (parts.length) out.push({ label: row.label, value: parts.join(' · ') })
  }
  return out
}

/**
 * How the genre uses words (3A): the prose answers, then the "special word
 * features" table. Starred (priority) features come first and are marked, since
 * those are the ones the researcher flagged to carry into the translation.
 */
export function genreWords(entries: Entry[], genreId: string): SummaryField[] {
  const inGenre = (e: Entry) => e.genre_id === genreId
  const out: SummaryField[] = []
  const prose: Array<[string, string]> = [
    ['Set phrases & repeated words', 's3a.expected'],
    ['Wordplay', 's3a.wordplay'],
    ['Kind of language', 's3a.language'],
    ['Special line constructions', 's3a.constructions'],
  ]
  for (const [label, id] of prose) {
    const f = field(label, trimmed(scalarEntry(entries, id, inGenre)?.text))
    if (f) out.push(f)
  }
  out.push(...featureRows(entries, genreId))
  return out
}

/** Rows of the s3a.features table, starred first, with the "how fixed" label. */
function featureRows(entries: Entry[], genreId: string): SummaryField[] {
  const node = findNode('s3a.features')?.node
  const modalityOpts = node?.columns?.find((c) => c.id === 'modality')?.options
  const order = rowOrder(entries, 's3a.features', genreId)
  const rows = order.map((rowId) => {
    const feature = trimmed(
      entries.find(
        (e) => e.node_id === 's3a.features' && e.genre_id === genreId && e.cell_key === `${rowId}__feature`,
      )?.text,
    )
    const modVal = entries.find(
      (e) => e.node_id === 's3a.features' && e.genre_id === genreId && e.cell_key === `${rowId}__modality`,
    )?.value
    const starred =
      entries.find(
        (e) => e.node_id === 's3a.features' && e.genre_id === genreId && e.cell_key === rowId,
      )?.is_priority === true
    return { feature, modality: modVal ? optionLabel(modalityOpts, modVal) : '', starred }
  })
  return rows
    .filter((r) => r.feature)
    .sort((a, b) => Number(b.starred) - Number(a.starred))
    .map((r) => ({
      label: r.starred ? '★ Key feature' : 'Feature',
      value: r.modality ? `${r.feature} (how fixed: ${r.modality})` : r.feature,
    }))
}

/** Ordered row ids for a repeatable table from its `__rows` sidecar entry. */
function rowOrder(entries: Entry[], nodeId: string, genreId: string): string[] {
  const sidecar = entries.find(
    (e) => e.node_id === nodeId && e.genre_id === genreId && e.cell_key === ROWS_KEY,
  )
  if (!sidecar?.value) return []
  try {
    const parsed = JSON.parse(sidecar.value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

/** First clause of a long column label, for compact grid display. */
function shortLabel(label: string): string {
  return label.split(/\s*[(（]/)[0].trim()
}
