/**
 * Renders the translation contract the Supabase Edge Function consumes.
 *
 * Lives here rather than in the script so a test can import it and assert the
 * committed artifact is current. Without that check, editing the glossary would
 * silently leave the deployed function using yesterday's terminology, and the
 * symptom would be inconsistent Indonesian in Bali rather than a build failure.
 */
import { LOCALES, SOURCE_LOCALE, type Locale } from '../i18n/locales'
import {
  buildSystemPrompt,
  glossaryFor,
  TRANSLATE_MAX_TOKENS,
  TRANSLATE_MODEL,
  TRANSLATE_OUTPUT_SCHEMA,
} from './prompt'

/** Path of the generated artifact, relative to the repo root. */
export const CONTRACT_PATH = 'supabase/functions/translate/contract.generated.json'

export function renderContract(): string {
  const systemPrompts: Record<string, string> = {}
  for (const locale of LOCALES) {
    if (locale === SOURCE_LOCALE) continue
    // Only locales with a glossary get a prompt. Translating without terminology
    // control would produce the inconsistency the glossary exists to prevent, so
    // the function rejects such a locale rather than guessing.
    if (glossaryFor(locale as Locale)) systemPrompts[locale] = buildSystemPrompt(locale as Locale)
  }
  return `${JSON.stringify(
    {
      $generated: 'Do not edit. Run `npm run i18n:contract` after changing the glossary or prompt.',
      $source: 'src/lib/translate/prompt.ts + src/content/glossary/<locale>.json',
      model: TRANSLATE_MODEL,
      maxTokens: TRANSLATE_MAX_TOKENS,
      outputSchema: TRANSLATE_OUTPUT_SCHEMA,
      systemPrompts,
    },
    null,
    2,
  )}\n`
}
