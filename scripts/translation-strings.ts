/**
 * Worksheet translation tooling. Run with vite-node so it shares the app's own key
 * scheme (`src/lib/i18n/keys.ts`) rather than reimplementing it — a drift between
 * the writer here and the reader in the app would silently fall every string back
 * to English, which is exactly the kind of failure nobody notices until a workshop.
 *
 *   npm run i18n:extract -- id     # write the translator's work file for a locale
 *   npm run i18n:report  -- id     # coverage, plus translations whose English moved
 *   npm run i18n:apply   -- id     # merge a completed work file into the catalogue
 *
 * The work file is derivable from the content, so it is gitignored; the catalogue
 * it produces (src/content/translations/<locale>.json) is committed.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { GuideContent, GuideNode } from '../src/schema/types'
import {
  columnKey,
  columnOptionKey,
  nodeKey,
  optionKey,
  rowKey,
  NODE_FIELDS,
  COLUMN_FIELDS,
  type NodeField,
} from '../src/lib/i18n/keys'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const CONTENT_PATH = resolve(repo, 'src/content/guide-content.json')
const catalogue = (locale: string) => resolve(repo, `src/content/translations/${locale}.json`)
const workFile = (locale: string) => resolve(repo, `translation-work/${locale}.work.json`)

/** Interpolation tokens the renderer substitutes; must survive translation verbatim. */
const TOKENS = ['{genre}', '{passage}'] as const

interface StringRecord {
  key: string
  /** The English text to translate. */
  source: string
  /** Which field this came from, so a translator knows the register expected. */
  role: string
  /** Breadcrumb of ancestor labels: where this appears in the worksheet. */
  context: string
  /** Interpolation tokens that must appear unchanged in the translation. */
  tokens?: string[]
  /** Existing translation, if any, so a re-run is a diff and not a restart. */
  existing?: string
  /** True when `existing` was made against different English text. */
  stale?: boolean
}

function hash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 12)
}

function tokensIn(text: string): string[] {
  return TOKENS.filter((t) => text.includes(t))
}

/** Every translatable string in document order, with the context a translator needs. */
function collect(content: GuideContent): StringRecord[] {
  const out: StringRecord[] = []

  const push = (key: string, source: string | undefined, role: string, context: string) => {
    if (!source || !source.trim()) return
    const tokens = tokensIn(source)
    out.push({ key, source, role, context, ...(tokens.length ? { tokens } : {}) })
  }

  const visit = (node: GuideNode, trail: string[]) => {
    const context = trail.length ? trail.join(' › ') : '(top level)'

    for (const field of NODE_FIELDS) {
      push(nodeKey(node.id, field), node[field as NodeField], `${node.type}.${field}`, context)
    }
    for (const o of node.options ?? []) {
      push(optionKey(node.id, o.id), o.label, 'option', `${context} › ${node.label}`)
    }
    for (const c of node.columns ?? []) {
      for (const field of COLUMN_FIELDS) {
        push(columnKey(node.id, c.id, field), c[field], `column.${field}`, `${context} › ${node.label}`)
      }
      for (const o of c.options ?? []) {
        push(
          columnOptionKey(node.id, c.id, o.id),
          o.label,
          'column.option',
          `${context} › ${node.label} › ${c.label}`,
        )
      }
    }
    for (const r of node.rows ?? []) {
      push(rowKey(node.id, r.id), r.label, 'row', `${context} › ${node.label}`)
    }

    for (const child of node.children ?? []) visit(child, [...trail, node.label])
  }

  for (const s of content.sections) visit(s, [])
  for (const c of content.chrome ?? []) visit(c, ['App chrome'])
  return out
}

interface CatalogueFile {
  $meta?: Record<string, unknown>
  $sourceHashes?: Record<string, string>
  [key: string]: unknown
}

function readCatalogue(locale: string): CatalogueFile {
  const path = catalogue(locale)
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as CatalogueFile
}

function translationsOf(file: CatalogueFile): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(file)) {
    if (k.startsWith('$')) continue
    if (typeof v === 'string' && v.trim()) out[k] = v
  }
  return out
}

function loadContent(): GuideContent {
  return JSON.parse(readFileSync(CONTENT_PATH, 'utf8')) as GuideContent
}

/** Annotate records with any existing translation and whether the English moved. */
function annotate(records: StringRecord[], locale: string): StringRecord[] {
  const file = readCatalogue(locale)
  const existing = translationsOf(file)
  const hashes = file.$sourceHashes ?? {}
  return records.map((r) => {
    const hit = existing[r.key]
    if (!hit) return r
    const recorded = hashes[r.key]
    const stale = recorded !== undefined && recorded !== hash(r.source)
    return { ...r, existing: hit, ...(stale ? { stale: true } : {}) }
  })
}

function cmdExtract(locale: string) {
  const records = annotate(collect(loadContent()), locale)
  const todo = records.filter((r) => !r.existing || r.stale)
  const path = workFile(locale)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        $instructions: [
          `Translate every "source" into ${locale} and put the result in "translation".`,
          'Leave "translation" empty to keep the English fallback.',
          'Any token listed in "tokens" must appear unchanged in the translation.',
          'Follow src/content/glossary/<locale>.json: use its term for every glossary',
          'entry, and never translate anything in its doNotTranslate list.',
          '"context" is the breadcrumb where the string appears; "role" is its field.',
        ],
        locale,
        sourceContentVersion: loadContent().version,
        counts: { total: records.length, needingWork: todo.length },
        strings: records.map((r) => ({ ...r, translation: r.stale ? '' : r.existing ?? '' })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  console.log(`wrote ${path}`)
  console.log(`  ${records.length} strings, ${todo.length} need work`)
}

function cmdReport(locale: string) {
  const records = annotate(collect(loadContent()), locale)
  const translated = records.filter((r) => r.existing && !r.stale)
  const staleOnes = records.filter((r) => r.stale)
  const missing = records.filter((r) => !r.existing)

  const pct = records.length ? Math.round((translated.length / records.length) * 100) : 0
  console.log(`locale ${locale}: ${translated.length}/${records.length} translated (${pct}%)`)

  if (staleOnes.length) {
    console.log(`\n${staleOnes.length} STALE (English changed since translating):`)
    for (const r of staleOnes) console.log(`  ${r.key}  ${JSON.stringify(r.source.slice(0, 70))}`)
  }
  if (missing.length) {
    console.log(`\n${missing.length} untranslated:`)
    for (const r of missing.slice(0, 40)) {
      console.log(`  ${r.key}  ${JSON.stringify(r.source.slice(0, 70))}`)
    }
    if (missing.length > 40) console.log(`  … and ${missing.length - 40} more`)
  }

  // Token loss is a rendering bug, not a style question: a dropped {passage}
  // leaves the user reading a sentence with a hole in it.
  const file = readCatalogue(locale)
  const existing = translationsOf(file)
  const tokenLoss = records.filter(
    (r) => r.tokens?.length && existing[r.key] && r.tokens.some((t) => !existing[r.key].includes(t)),
  )
  if (tokenLoss.length) {
    console.log(`\n${tokenLoss.length} TRANSLATIONS DROPPED AN INTERPOLATION TOKEN:`)
    for (const r of tokenLoss) console.log(`  ${r.key}  expected ${r.tokens?.join(' ')}`)
  }
  if (!staleOnes.length && !missing.length && !tokenLoss.length) console.log('\nno issues')
}

/** Merge a completed work file into the committed catalogue. */
function cmdApply(locale: string) {
  const path = workFile(locale)
  if (!existsSync(path)) {
    console.error(`no work file at ${path} — run i18n:extract first`)
    process.exit(1)
  }
  const work = JSON.parse(readFileSync(path, 'utf8')) as {
    strings: (StringRecord & { translation?: string })[]
  }
  const content = loadContent()
  const sources = new Map(collect(content).map((r) => [r.key, r.source]))

  const existingFile = readCatalogue(locale)
  const merged: Record<string, string> = translationsOf(existingFile)
  const hashes: Record<string, string> = { ...(existingFile.$sourceHashes ?? {}) }

  let applied = 0
  const rejected: string[] = []
  for (const s of work.strings) {
    const value = (s.translation ?? '').trim()
    if (!value) continue
    const source = sources.get(s.key)
    if (source === undefined) {
      rejected.push(`${s.key} (no longer in the content)`)
      continue
    }
    // Refuse a translation that dropped a token; it would render a broken sentence.
    const lost = tokensIn(source).filter((t) => !value.includes(t))
    if (lost.length) {
      rejected.push(`${s.key} (dropped ${lost.join(' ')})`)
      continue
    }
    merged[s.key] = value
    hashes[s.key] = hash(source)
    applied += 1
  }

  // Drop keys whose content node is gone, so the catalogue cannot accumulate cruft.
  for (const key of Object.keys(merged)) {
    if (!sources.has(key)) {
      delete merged[key]
      delete hashes[key]
    }
  }

  const out: CatalogueFile = {
    $meta: {
      ...(existingFile.$meta ?? {}),
      locale,
      sourceContentVersion: content.version,
    },
    $sourceHashes: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))),
    ...Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
  }
  writeFileSync(catalogue(locale), `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(`applied ${applied} translations to ${catalogue(locale)}`)
  if (rejected.length) {
    console.log(`rejected ${rejected.length}:`)
    for (const r of rejected) console.log(`  ${r}`)
  }
}

const [cmd, locale = 'id'] = process.argv.slice(2)
if (cmd === 'extract') cmdExtract(locale)
else if (cmd === 'report') cmdReport(locale)
else if (cmd === 'apply') cmdApply(locale)
else {
  console.error('usage: translation-strings.ts <extract|report|apply> [locale]')
  process.exit(1)
}
