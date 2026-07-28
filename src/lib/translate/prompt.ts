/**
 * Canonical construction of the translation request.
 *
 * This module is the single source of truth for HOW the model is asked to
 * translate. The Supabase Edge Function cannot import from `src/` (it is bundled
 * separately, and runs on Deno), so its copy of the system prompt is GENERATED
 * from here by `npm run i18n:contract` and checked for drift by a test. That keeps
 * one authored prompt while letting two runtimes use it.
 *
 * Why the prompt lives server-side at all: the function must not accept a
 * caller-supplied prompt. If it did, anyone holding a beta login could send
 * arbitrary text to the model on Joshua's key. The client sends only structured
 * fields (source text, target locale, and which worksheet question it answers) and
 * the server decides the wording.
 */
import glossaryId from '../../content/glossary/id.json'
import { LOCALE_LABELS, type Locale } from '../i18n/locales'

/** Model choice: Haiku is fast enough for an interactive field and cheap in bulk. */
export const TRANSLATE_MODEL = 'claude-haiku-4-5'

/**
 * Output cap. Answers are short (a sentence to a paragraph); a generous ceiling
 * still bounds a runaway response without truncating legitimate output.
 */
export const TRANSLATE_MAX_TOKENS = 2048

interface GlossaryTerm {
  en: string
  id: string
  note?: string
  needsReview?: boolean
}

interface Glossary {
  doNotTranslate: string[]
  notes: string[]
  terms: GlossaryTerm[]
}

const GLOSSARIES: Partial<Record<Locale, Glossary>> = {
  id: glossaryId as Glossary,
}

export function glossaryFor(locale: Locale): Glossary | undefined {
  return GLOSSARIES[locale]
}

/**
 * A JSON-schema-constrained response. Without this the model tends to answer a
 * translation request with "Here is the translation: …", and that preamble would
 * be written straight into the team's field. Structured outputs make a bare
 * translation the only shape the API can return.
 */
export const TRANSLATE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    translation: {
      type: 'string',
      description: 'The translated text, and nothing else.',
    },
    unchanged: {
      type: 'boolean',
      description:
        'True when the input was already in the target language and was returned as-is.',
    },
  },
  required: ['translation', 'unchanged'],
  additionalProperties: false,
} as const

/**
 * The system prompt for translating a team's worksheet answers.
 *
 * Deliberately narrow. This translates field notes written by translation teams
 * during genre research: short, plain, often fragmentary, and full of domain
 * vocabulary that has one correct rendering fixed by the glossary.
 */
export function buildSystemPrompt(locale: Locale): string {
  const glossary = glossaryFor(locale)
  const language = LOCALE_LABELS[locale] ?? locale

  const lines: string[] = [
    `You translate research notes into ${language} for a Bible-translation workshop.`,
    '',
    'The text you receive was typed or dictated by a translation team studying the',
    'song, poetry, and story forms of their own community. It is field notes: often',
    'short, sometimes a fragment rather than a sentence, occasionally mid-thought.',
    'Translate what is there. Do not tidy it, expand it, summarise it, or answer it.',
    '',
    'Rules:',
    `- Render the meaning in natural, plain ${language} at the register a community`,
    '  member would use out loud. Not academic, not formal officialese.',
    '- Keep the length close to the original. A fragment stays a fragment.',
    '- Preserve the original line breaks and list structure.',
    '- Never add commentary, notes, alternatives, or explanation of your choices.',
    '- If a proper name, place, or local genre name has no established translation,',
    '  keep it exactly as written.',
    `- If the text is ALREADY in ${language}, return it unchanged and set`,
    '  "unchanged" to true.',
  ]

  if (glossary?.doNotTranslate.length) {
    lines.push(
      '',
      'Never translate or alter these, and reproduce them character for character:',
      ...glossary.doNotTranslate.map((d) => `- ${d}`),
    )
  }

  if (glossary?.notes.length) {
    lines.push('', 'Notes on this language pair:', ...glossary.notes.map((n) => `- ${n}`))
  }

  if (glossary?.terms.length) {
    lines.push(
      '',
      `Required terminology. Where the source expresses one of these concepts, use the`,
      `given ${language} term so the same idea is never rendered two ways:`,
    )
    for (const t of glossary.terms) {
      lines.push(t.note ? `- ${t.en} -> ${t.id}  (${t.note})` : `- ${t.en} -> ${t.id}`)
    }
  }

  return lines.join('\n')
}

export interface TranslateRequest {
  /** The team's answer, exactly as stored. */
  text: string
  targetLocale: Locale
  /** The English worksheet question this answers, for disambiguation. */
  question?: string
}

/**
 * The user message. The question is supplied as context the model may read but
 * must not translate, which resolves the many one-word answers ("fixed", "high")
 * that are ambiguous without knowing what was asked.
 */
export function buildUserMessage(req: TranslateRequest): string {
  const parts: string[] = []
  if (req.question?.trim()) {
    parts.push(
      'Context — the worksheet question being answered (do NOT translate this, it is',
      'only here to disambiguate the answer):',
      req.question.trim(),
      '',
    )
  }
  parts.push('Translate this answer:', req.text)
  return parts.join('\n')
}
