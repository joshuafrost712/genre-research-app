/**
 * The curated glossary, rendered as a Google Cloud Translation glossary file.
 *
 * The Anthropic engine gets the glossary as terminology inside a prompt, where the
 * model can weigh it. Google has no prompt, so the same knowledge has to arrive as
 * a glossary resource: exact-term substitution at decode time. This module is the
 * conversion, kept beside the app rather than in a setup script so the rules that
 * decide what survives the conversion are testable.
 *
 * Format: an "equivalent term sets" CSV, whose first row is language codes. That
 * shape is chosen over the unidirectional one for a specific reason — translation
 * here is bidirectional (a team working in Indonesian has to produce English for a
 * consultant), and one equivalent-set resource serves both directions, where
 * unidirectional glossaries would need two resources kept in step.
 *
 * Two things are dropped rather than guessed at:
 *
 *  - A term whose rendering is shared with another term. `performance` and
 *    `presentation` both reaching `penyajian` is fine going out and ambiguous
 *    coming back, and an equivalent set asserts the terms ARE equivalent, so
 *    including both would license translating `penyajian` as either. The same rule
 *    the into-English prompt already applies (see `reverseGlossaryIntoEnglish`).
 *  - Anything in `doNotTranslate` that is also a translatable term. Asking the
 *    glossary to both preserve a word and replace it is a contradiction; the
 *    prompt path resolves it the same way.
 */
import glossary from '../../content/glossary/id.json'

export interface GlossaryRow {
  en: string
  id: string
}

interface RawGlossary {
  doNotTranslate?: string[]
  terms?: { en: string; id: string }[]
}

const raw = glossary as RawGlossary

/** RFC 4180 quoting: only when the field needs it. */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Term pairs safe to assert as equivalents in both directions.
 *
 * Uniqueness is enforced on BOTH sides. Dropping only Indonesian collisions would
 * leave the reverse direction clean and the forward direction claiming two
 * different renderings for one English term, which is the same defect mirrored.
 */
export function bidirectionalTerms(): GlossaryRow[] {
  const byEn = new Map<string, Set<string>>()
  const byId = new Map<string, Set<string>>()

  for (const term of raw.terms ?? []) {
    const en = term.en?.trim()
    const id = term.id?.trim()
    if (!en || !id) continue
    const enKey = en.toLowerCase()
    const idKey = id.toLowerCase()
    if (!byEn.has(enKey)) byEn.set(enKey, new Set())
    if (!byId.has(idKey)) byId.set(idKey, new Set())
    byEn.get(enKey)!.add(idKey)
    byId.get(idKey)!.add(enKey)
  }

  const seen = new Set<string>()
  const rows: GlossaryRow[] = []
  for (const term of raw.terms ?? []) {
    const en = term.en?.trim()
    const id = term.id?.trim()
    if (!en || !id) continue
    const enKey = en.toLowerCase()
    const idKey = id.toLowerCase()
    if (byEn.get(enKey)!.size !== 1 || byId.get(idKey)!.size !== 1) continue
    if (seen.has(enKey)) continue
    seen.add(enKey)
    rows.push({ en, id })
  }
  return rows.sort((a, b) => a.en.localeCompare(b.en))
}

/**
 * Terms mapped to themselves so the engine leaves them alone.
 *
 * The prompt path states this as an instruction ("never translate or alter
 * these"); a glossary can only express it as an identity pair, which works because
 * substitution replaces the match with the given target. Interpolation tokens are
 * included: they should not appear inside an answer, but if a team pastes worksheet
 * text into one, `{genre}` surviving intact is the difference between a usable
 * string and a broken one.
 */
export function protectedTerms(): GlossaryRow[] {
  const translatable = new Set(bidirectionalTerms().map((r) => r.id.toLowerCase()))
  const out: GlossaryRow[] = []
  const seen = new Set<string>()
  for (const term of raw.doNotTranslate ?? []) {
    const t = term.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key) || translatable.has(key)) continue
    seen.add(key)
    out.push({ en: t, id: t })
  }
  return out.sort((a, b) => a.en.localeCompare(b.en))
}

/** The complete CSV, header row first, ready to upload to Cloud Storage. */
export function buildGoogleGlossaryCsv(): string {
  const rows = [...bidirectionalTerms(), ...protectedTerms()]
  const lines = ['en,id', ...rows.map((r) => `${csvField(r.en)},${csvField(r.id)}`)]
  return `${lines.join('\n')}\n`
}
