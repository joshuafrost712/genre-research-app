/**
 * App-chrome strings: the text the app itself owns, as opposed to worksheet
 * content (which lives in `guide-content.json` and is translated via
 * `content/translations/<locale>.json`).
 *
 * A plain typed catalogue rather than an i18n library. This codebase has no i18n
 * dependency and hand-rolls comparable primitives (see `AutosaveText`,
 * `DepthModeContext`), and the chrome surface is small enough that a library's
 * pluralisation and interpolation machinery would be more weight than help.
 *
 * `en` is required on every entry and is the fallback; other locales are optional,
 * so chrome can be localised incrementally without breaking the build or
 * rendering a raw key to a user.
 */
import { SOURCE_LOCALE, type Locale } from './locales'

type UiEntry = { en: string } & Partial<Record<Locale, string>>

const UI = {
  'lang.label': { en: 'Language', id: 'Bahasa' },
  'lang.switchTo': { en: 'Switch language', id: 'Ganti bahasa' },

  'translate.action': { en: 'Translate', id: 'Terjemahkan' },
  'translate.inFlight': { en: 'Translating…', id: 'Menerjemahkan…' },
  'translate.retry': { en: 'Try again', id: 'Coba lagi' },
  'translate.failed': {
    en: 'Could not translate just now. Your answer is saved.',
    id: 'Belum bisa menerjemahkan. Jawaban Anda tetap tersimpan.',
  },
  'translate.queued': {
    en: 'Queued for translation.',
    id: 'Menunggu diterjemahkan.',
  },
  'translate.editHint': {
    en: 'Edit the translation if it needs adjusting.',
    id: 'Ubah terjemahan ini bila perlu disesuaikan.',
  },
  'translate.sourceLabel': { en: 'Original', id: 'Asli' },
  'translate.translationLabel': { en: 'Translation', id: 'Terjemahan' },
  'translate.staleNote': {
    en: 'The original changed, so the old translation was cleared.',
    id: 'Teks asli berubah, jadi terjemahan lama dihapus.',
  },
} satisfies Record<string, UiEntry>

export type UiKey = keyof typeof UI

/** A chrome string in `locale`, falling back to English. */
export function t(locale: Locale, key: UiKey): string {
  const entry: UiEntry = UI[key]
  if (locale === SOURCE_LOCALE) return entry.en
  return entry[locale] ?? entry.en
}

/**
 * Chrome keys that have no translation for `locale`. Used by the dev-mode
 * coverage report so an untranslated string is a visible gap, not a silent
 * English fallback a reviewer never notices.
 */
export function missingChromeKeys(locale: Locale): UiKey[] {
  if (locale === SOURCE_LOCALE) return []
  return (Object.keys(UI) as UiKey[]).filter((k) => !(UI[k] as UiEntry)[locale])
}
