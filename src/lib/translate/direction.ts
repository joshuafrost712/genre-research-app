/**
 * Which language an answer should be translated INTO.
 *
 * This is bidirectional on purpose, and that is a correction to the first cut of
 * this feature. The original rule translated everything into the configured target
 * (Indonesian), which quietly broke the most important review case: a team typing
 * in Indonesian got no English, so the consultant who cannot read Indonesian had
 * nothing to review. Worse, the field offered "translate to Indonesian" on text
 * that was already Indonesian, and then hid itself once it noticed.
 *
 * The rule instead follows the reader. Joshua's framing: the people doing data
 * entry and review are usually bilingual and switch back and forth constantly, so
 * the question a field should answer is always "give me this in the language I am
 * currently reading in".
 *
 *   answer language | UI language | target      | why
 *   ----------------|-------------|-------------|-----------------------------------
 *   English         | Indonesian  | Indonesian  | reading in Indonesian
 *   Indonesian      | English     | English     | the consultant review case
 *   English         | English     | Indonesian  | write once, hand to the team
 *   Indonesian      | Indonesian  | English     | write once, hand to the reviewer
 *
 * The last two rows are what makes a single toggle enough: whichever language you
 * are working in, the field offers the other one, so nobody has to switch the whole
 * UI just to produce a translation.
 */
import { DEFAULT_TRANSLATION_TARGET } from './config'
import { isLocale, SOURCE_LOCALE, type Locale } from '../i18n/locales'

/** The locale an answer was written in, tolerating unset and unknown values. */
export function answerLocale(sourceLanguage: string | undefined | null): Locale {
  // Entries predating the i18n work have no source_language, and a synced record
  // could carry a locale this build does not support. Both mean "assume English"
  // rather than throwing away the row.
  return isLocale(sourceLanguage) ? sourceLanguage : SOURCE_LOCALE
}

/**
 * "The other language" for someone working in `uiLocale`: the configured target
 * when they are in English, English otherwise. Null when there is no second
 * language, which only happens in a build configured with one locale.
 *
 * Exported because three places need this same notion, and they were each deriving
 * it: the per-answer target below, the field's default target, and the bilingual
 * export's second column. One definition means a third language cannot be added
 * correctly in two places and wrongly in the third.
 */
export function partnerLocale(uiLocale: Locale): Locale | null {
  const partner = uiLocale === SOURCE_LOCALE ? DEFAULT_TRANSLATION_TARGET : SOURCE_LOCALE
  return partner === uiLocale ? null : partner
}

/**
 * The translation target for an answer being read in `uiLocale`, or null when
 * there is no second language to offer.
 */
export function translationTargetFor(
  sourceLanguage: string | undefined | null,
  uiLocale: Locale,
): Locale | null {
  const source = answerLocale(sourceLanguage)

  // Reading in a language the answer is not in: that language is the target.
  if (source !== uiLocale) return uiLocale

  // Already reading in the answer's own language, so offer the other one.
  const partner = partnerLocale(uiLocale)
  return partner === source ? null : partner
}
