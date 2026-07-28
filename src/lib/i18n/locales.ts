/**
 * Supported app locales.
 *
 * English is the source language and the offline floor: every other locale is a
 * translation layered over it, and any missing translation falls back to English
 * rather than rendering blank. Adding a locale means adding it here plus a
 * `src/content/translations/<code>.json` catalogue; nothing else is hard-coded.
 *
 * Bahasa Indonesia is first because the Bali workshop (Aug 24 to Sep 4, 2026)
 * runs with Indonesian mother-tongue translation teams.
 */
export const LOCALES = ['en', 'id'] as const

export type Locale = (typeof LOCALES)[number]

/** The source language. Never translated; always the fallback. */
export const SOURCE_LOCALE: Locale = 'en'

/**
 * Endonyms: each language named as its own speakers name it, so a team member
 * can find their language in the switcher without reading English.
 */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  id: 'Bahasa Indonesia',
}

/** Short chip shown in the compact header switcher. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  id: 'ID',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
