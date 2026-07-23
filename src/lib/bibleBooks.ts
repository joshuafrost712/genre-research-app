/**
 * Canonical Bible book list + a best-effort reference parser, added for passage
 * management (feedback 2026-07-22 #1): passages need book-awareness so they can
 * be retired to a "completed" folder in canonical order and searched by book
 * title. Passages historically stored only a free-text `reference` ("Psalm 13"),
 * so the parser exists both to power the picker and to backfill old passages in
 * the v5 migration.
 *
 * Order is the standard Protestant/Christian canon (Genesis → Revelation), which
 * is what `canonicalIndex` returns; unknown books sort last.
 */

export interface BibleBook {
  /** Canonical full name, used as the stored `book` value. */
  name: string
  /** Lower-case forms that should resolve to this book (no dots, spaces normalized). */
  aliases: string[]
}

/**
 * 66 books in canonical order. Aliases cover the common abbreviations a
 * facilitator might type; matching also strips periods and collapses spaces, so
 * "Ps.", "Ps", and "psalm" all resolve.
 */
export const BIBLE_BOOKS: BibleBook[] = [
  { name: 'Genesis', aliases: ['gen', 'ge', 'gn'] },
  { name: 'Exodus', aliases: ['exod', 'exo', 'ex'] },
  { name: 'Leviticus', aliases: ['lev', 'le', 'lv'] },
  { name: 'Numbers', aliases: ['num', 'nu', 'nm', 'nb'] },
  { name: 'Deuteronomy', aliases: ['deut', 'deu', 'dt'] },
  { name: 'Joshua', aliases: ['josh', 'jos', 'jsh'] },
  { name: 'Judges', aliases: ['judg', 'jdg', 'jg', 'jdgs'] },
  { name: 'Ruth', aliases: ['rth', 'ru'] },
  { name: '1 Samuel', aliases: ['1 sam', '1sam', '1 sa', '1sa', '1 s', 'i sam', 'first samuel'] },
  { name: '2 Samuel', aliases: ['2 sam', '2sam', '2 sa', '2sa', '2 s', 'ii sam', 'second samuel'] },
  { name: '1 Kings', aliases: ['1 kgs', '1kgs', '1 ki', '1ki', '1 kin', 'i kings', 'first kings'] },
  { name: '2 Kings', aliases: ['2 kgs', '2kgs', '2 ki', '2ki', '2 kin', 'ii kings', 'second kings'] },
  { name: '1 Chronicles', aliases: ['1 chron', '1 chr', '1chr', '1 ch', '1ch', 'i chronicles', 'first chronicles'] },
  { name: '2 Chronicles', aliases: ['2 chron', '2 chr', '2chr', '2 ch', '2ch', 'ii chronicles', 'second chronicles'] },
  { name: 'Ezra', aliases: ['ezr', 'ez'] },
  { name: 'Nehemiah', aliases: ['neh', 'ne'] },
  { name: 'Esther', aliases: ['esth', 'est', 'es'] },
  { name: 'Job', aliases: ['jb'] },
  { name: 'Psalms', aliases: ['psalm', 'ps', 'psa', 'pss', 'psm'] },
  { name: 'Proverbs', aliases: ['prov', 'pro', 'prv', 'pr'] },
  { name: 'Ecclesiastes', aliases: ['eccl', 'ecc', 'ec', 'qoh'] },
  { name: 'Song of Songs', aliases: ['song', 'song of solomon', 'sos', 'sng', 'canticles', 'cant'] },
  { name: 'Isaiah', aliases: ['isa', 'is'] },
  { name: 'Jeremiah', aliases: ['jer', 'je', 'jr'] },
  { name: 'Lamentations', aliases: ['lam', 'la'] },
  { name: 'Ezekiel', aliases: ['ezek', 'eze', 'ezk'] },
  { name: 'Daniel', aliases: ['dan', 'da', 'dn'] },
  { name: 'Hosea', aliases: ['hos', 'ho'] },
  { name: 'Joel', aliases: ['joe', 'jl'] },
  { name: 'Amos', aliases: ['am', 'amo'] },
  { name: 'Obadiah', aliases: ['obad', 'oba', 'ob'] },
  { name: 'Jonah', aliases: ['jon', 'jnh'] },
  { name: 'Micah', aliases: ['mic', 'mi'] },
  { name: 'Nahum', aliases: ['nah', 'na'] },
  { name: 'Habakkuk', aliases: ['hab', 'hb'] },
  { name: 'Zephaniah', aliases: ['zeph', 'zep', 'zp'] },
  { name: 'Haggai', aliases: ['hag', 'hg'] },
  { name: 'Zechariah', aliases: ['zech', 'zec', 'zc'] },
  { name: 'Malachi', aliases: ['mal', 'ml'] },
  { name: 'Matthew', aliases: ['matt', 'mat', 'mt'] },
  { name: 'Mark', aliases: ['mrk', 'mk', 'mr'] },
  { name: 'Luke', aliases: ['luk', 'lk'] },
  { name: 'John', aliases: ['jhn', 'jn'] },
  { name: 'Acts', aliases: ['act', 'ac'] },
  { name: 'Romans', aliases: ['rom', 'ro', 'rm'] },
  { name: '1 Corinthians', aliases: ['1 cor', '1cor', '1 co', '1co', 'i corinthians', 'first corinthians'] },
  { name: '2 Corinthians', aliases: ['2 cor', '2cor', '2 co', '2co', 'ii corinthians', 'second corinthians'] },
  { name: 'Galatians', aliases: ['gal', 'ga'] },
  { name: 'Ephesians', aliases: ['eph', 'ephes'] },
  { name: 'Philippians', aliases: ['phil', 'php', 'pp'] },
  { name: 'Colossians', aliases: ['col', 'co'] },
  { name: '1 Thessalonians', aliases: ['1 thess', '1 thes', '1thess', '1 th', '1th', 'i thessalonians'] },
  { name: '2 Thessalonians', aliases: ['2 thess', '2 thes', '2thess', '2 th', '2th', 'ii thessalonians'] },
  { name: '1 Timothy', aliases: ['1 tim', '1tim', '1 ti', '1ti', 'i timothy', 'first timothy'] },
  { name: '2 Timothy', aliases: ['2 tim', '2tim', '2 ti', '2ti', 'ii timothy', 'second timothy'] },
  { name: 'Titus', aliases: ['tit', 'ti'] },
  { name: 'Philemon', aliases: ['philem', 'phm', 'pm'] },
  { name: 'Hebrews', aliases: ['heb', 'he'] },
  { name: 'James', aliases: ['jas', 'jm'] },
  { name: '1 Peter', aliases: ['1 pet', '1pet', '1 pe', '1pe', '1 pt', 'i peter', 'first peter'] },
  { name: '2 Peter', aliases: ['2 pet', '2pet', '2 pe', '2pe', '2 pt', 'ii peter', 'second peter'] },
  { name: '1 John', aliases: ['1 jn', '1jn', '1 jhn', '1 jo', 'i john', 'first john'] },
  { name: '2 John', aliases: ['2 jn', '2jn', '2 jhn', '2 jo', 'ii john', 'second john'] },
  { name: '3 John', aliases: ['3 jn', '3jn', '3 jhn', '3 jo', 'iii john', 'third john'] },
  { name: 'Jude', aliases: ['jud', 'jd'] },
  { name: 'Revelation', aliases: ['rev', 're', 'apocalypse', 'apoc'] },
]

/** Just the canonical names, for a dropdown. */
export const BIBLE_BOOK_NAMES: string[] = BIBLE_BOOKS.map((b) => b.name)

const INDEX_BY_NAME = new Map(BIBLE_BOOKS.map((b, i) => [b.name, i]))

/** Normalize a book token: lower-case, strip periods, collapse whitespace. */
function normalizeToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// name + every alias → canonical name, for fast lookup.
const CANONICAL_BY_TOKEN = new Map<string, string>()
for (const b of BIBLE_BOOKS) {
  CANONICAL_BY_TOKEN.set(normalizeToken(b.name), b.name)
  for (const a of b.aliases) CANONICAL_BY_TOKEN.set(normalizeToken(a), b.name)
}

/**
 * Canonical position of a book (0 = Genesis). Unknown/empty books sort last so
 * an unparsed passage never jumps to the top of the completed folder.
 */
export function canonicalIndex(book: string | undefined): number {
  if (!book) return Number.MAX_SAFE_INTEGER
  const idx = INDEX_BY_NAME.get(book)
  return idx ?? Number.MAX_SAFE_INTEGER
}

/** Resolve a free-text book token ("Ps", "1 cor", "psalms") to a canonical name. */
export function resolveBook(token: string): string | undefined {
  return CANONICAL_BY_TOKEN.get(normalizeToken(token))
}

export interface ParsedReference {
  book?: string
  chapter?: number
  verse_start?: number
  verse_end?: number
}

/**
 * Best-effort parse of a free-text reference such as "Psalm 13", "Ps 13:1-2",
 * "1 Cor 13", "1 Corinthians 13:4-7". Returns whatever it can resolve; a
 * reference it can't read yields an empty object (the passage keeps its label
 * and simply sorts last in the completed folder). Never throws.
 */
export function parseReference(reference: string): ParsedReference {
  const raw = (reference ?? '').trim()
  if (!raw) return {}
  // Leading optional book number (1/2/3 or i/ii/iii), then the book word(s),
  // then chapter[:verse[-verse]].
  const m = raw.match(
    /^\s*((?:[123]|i{1,3})\s+)?([a-zA-Z][a-zA-Z.\s]*?)\s*(\d+)?\s*(?::\s*(\d+)\s*(?:[-–]\s*(\d+))?)?\s*$/,
  )
  if (!m) return {}
  const numberPrefix = (m[1] ?? '').trim()
  const bookWords = (m[2] ?? '').trim()
  const bookToken = numberPrefix ? `${numberPrefix} ${bookWords}` : bookWords
  const book = resolveBook(bookToken) ?? resolveBook(bookWords)
  const chapter = m[3] ? Number(m[3]) : undefined
  const verse_start = m[4] ? Number(m[4]) : undefined
  const verse_end = m[5] ? Number(m[5]) : verse_start
  const out: ParsedReference = {}
  if (book) out.book = book
  if (chapter != null && !Number.isNaN(chapter)) out.chapter = chapter
  if (verse_start != null && !Number.isNaN(verse_start)) out.verse_start = verse_start
  if (verse_end != null && !Number.isNaN(verse_end)) out.verse_end = verse_end
  return out
}

/** Compose a display reference from structured fields (inverse of parse). */
export function formatReference(fields: ParsedReference): string {
  if (!fields.book) return ''
  let out = fields.book
  if (fields.chapter != null) {
    out += ` ${fields.chapter}`
    if (fields.verse_start != null) {
      out += `:${fields.verse_start}`
      if (fields.verse_end != null && fields.verse_end !== fields.verse_start) {
        out += `-${fields.verse_end}`
      }
    }
  }
  return out
}

/**
 * Does a passage match a search query? Matches on the raw reference text and on
 * the resolved book name / any alias, so "psalm", "ps", and "Psalm 13" all find
 * a Psalms passage. An empty query matches everything.
 */
export function passageMatchesQuery(
  reference: string,
  book: string | undefined,
  query: string,
): boolean {
  const q = normalizeToken(query)
  if (!q) return true
  if (normalizeToken(reference).includes(q)) return true
  if (book) {
    if (normalizeToken(book).includes(q)) return true
    // Match when the query is an alias of the book.
    if (resolveBook(query) === book) return true
  }
  return false
}
