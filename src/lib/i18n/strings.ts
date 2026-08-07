/**
 * App-chrome strings: the text the app itself owns, as opposed to worksheet
 * content (which lives in `guide-content.json` and is translated via
 * `content/translations/<locale>.json`).
 *
 * A plain typed catalogue rather than an i18n library. This codebase has no i18n
 * dependency and hand-rolls comparable primitives (see `AutosaveText`,
 * `DepthModeContext`), and the chrome surface is small enough that a library's
 * pluralisation machinery would be more weight than help. Interpolation is the one
 * thing that earned its keep, and it is six lines below.
 *
 * `en` is required on every entry and is the fallback; other locales are optional,
 * so chrome can be localised incrementally without breaking the build or
 * rendering a raw key to a user.
 *
 * The navigation entries matter more than they look. Translating the worksheet but
 * leaving the menu in English produces an app that claims to be bilingual and is
 * not: the nav is the first thing anyone reads and the thing they read most often.
 */
import { SOURCE_LOCALE, type Locale } from './locales'

type UiEntry = { en: string } & Partial<Record<Locale, string>>

const UI = {
  'lang.label': { en: 'Language', id: 'Bahasa' },
  'lang.switchTo': { en: 'Switch language', id: 'Ganti bahasa' },
  'lang.readingIn': { en: 'Reading in', id: 'Dibaca dalam' },

  'nav.home': { en: 'Home', id: 'Beranda' },
  'nav.wizard': { en: 'Step-by-step guide', id: 'Panduan langkah demi langkah' },
  'nav.capture': { en: 'Quick note', id: 'Catatan cepat' },
  'nav.routing': { en: 'Sort notes with AI', id: 'Susun catatan dengan AI' },
  'nav.review': { en: 'Review AI suggestions', id: 'Tinjau saran AI' },
  'nav.genres': { en: 'Passages & Genres', id: 'Perikop & Genre' },
  'nav.followUp': { en: 'Follow up', id: 'Tindak lanjut' },
  'nav.export': { en: 'Export', id: 'Ekspor' },
  'nav.help': { en: 'Help', id: 'Bantuan' },
  'nav.teams': { en: 'Teams', id: 'Tim' },
  'nav.openMenu': { en: 'Open menu', id: 'Buka menu' },
  'nav.progress': { en: 'Progress', id: 'Kemajuan' },
  'nav.depth': { en: 'Depth', id: 'Kedalaman' },
  'nav.workspace': { en: 'Workspace {n}', id: 'Ruang Kerja {n}' },

  'depth.quick': { en: 'Quick', id: 'Ringkas' },
  'depth.standard': { en: 'Standard', id: 'Standar' },
  'depth.comprehensive': { en: 'Comprehensive', id: 'Menyeluruh' },

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
  // Why it queued. "Queued." alone leaves a facilitator with nothing to act on,
  // and the first of these is a ten-second fix rather than a fault.
  'translate.queuedSignIn': {
    en: 'Sign in (top right) to translate straight away.',
    id: 'Masuk (kanan atas) agar terjemahan langsung muncul.',
  },
  'translate.queuedNeedsTesterLink': {
    en: 'Instant translation needs a tester sign-in. Open the app from the tester link, sign in, and try again.',
    id: 'Terjemahan langsung memerlukan masuk sebagai penguji. Buka aplikasi dari tautan penguji, masuk, lalu coba lagi.',
  },
  'translate.queuedNotConfigured': {
    en: 'Instant translation is not switched on for this site yet, so this is saved for the next batch.',
    id: 'Terjemahan langsung belum diaktifkan di situs ini, jadi ini disimpan untuk kumpulan berikutnya.',
  },
  'translate.queuedBusy': {
    en: 'Too many translations at once. Saved, and it will catch up.',
    id: 'Terlalu banyak permintaan sekaligus. Sudah disimpan dan akan menyusul.',
  },
  'translate.queuedOffline': {
    en: 'No connection right now. Saved, and it will translate once you are back online.',
    id: 'Tidak ada koneksi saat ini. Sudah disimpan dan akan diterjemahkan setelah kembali online.',
  },
  'translate.editHint': {
    en: 'Edit the translation if it needs adjusting.',
    id: 'Ubah terjemahan ini bila perlu disesuaikan.',
  },
  'translate.offer': {
    en: 'Translate this answer into {language}.',
    id: 'Terjemahkan jawaban ini ke {language}.',
  },
  'translate.showAll': { en: 'Show translations', id: 'Tampilkan terjemahan' },
  'translate.hideAll': { en: 'Hide translations', id: 'Sembunyikan terjemahan' },
  'translate.translateTable': {
    en: 'Translate filled cells',
    id: 'Terjemahkan sel yang terisi',
  },
  'translate.sourceLabel': { en: 'Original', id: 'Asli' },
  'translate.translationLabel': { en: 'Translation', id: 'Terjemahan' },
  'translate.staleNote': {
    en: 'The original changed, so the old translation was cleared.',
    id: 'Teks asli berubah, jadi terjemahan lama dihapus.',
  },

  // Sync chip. The signed-out label is the important one: this chip used to
  // render nothing at all while signed out, and an absent indicator reads as a
  // healthy one. Saying "on this device only" is what stops someone filling in a
  // worksheet for an hour without realising none of it has an account behind it.
  'sync.localOnly': { en: 'On this device only', id: 'Hanya di perangkat ini' },
  'sync.localOnlyDetail': {
    en: 'You are not signed in, so answers are saved on this device only. Sign in to keep them safe.',
    id: 'Anda belum masuk, jadi jawaban hanya tersimpan di perangkat ini. Masuk agar tersimpan dengan aman.',
  },
  'sync.saved': { en: 'Saved', id: 'Tersimpan' },
  'sync.offline': { en: 'Offline', id: 'Offline' },
  'sync.failed': { en: 'Sync failed', id: 'Sinkronisasi gagal' },
  'sync.off': { en: 'Sync off', id: 'Sinkronisasi dimatikan' },
  'sync.waiting': { en: '{n} waiting', id: '{n} menunggu' },
  'sync.tapToSync': { en: 'Tap to sync now.', id: 'Ketuk untuk sinkronkan sekarang.' },

  // Session loss.
  'account.signedOutTitle': { en: 'You have been signed out', id: 'Anda telah keluar dari akun' },
  'account.signedOutBody': {
    en: 'Your work is safe on this device. Sign back in to save it to your account and see it on your other devices.',
    id: 'Pekerjaan Anda aman di perangkat ini. Masuk kembali agar tersimpan ke akun Anda dan terlihat di perangkat lain.',
  },
  'account.signBackIn': { en: 'Sign back in', id: 'Masuk kembali' },
  'account.continueWithout': { en: 'Continue without an account', id: 'Lanjutkan tanpa akun' },
  'account.localOnlyBanner': {
    en: 'Working on this device only. Your answers will be added to your account next time you sign in.',
    id: 'Bekerja hanya di perangkat ini. Jawaban Anda akan ditambahkan ke akun saat Anda masuk lagi.',
  },
  'account.storageLabel': { en: 'Offline storage', id: 'Penyimpanan di perangkat' },
  'account.storageProtected': { en: 'protected', id: 'terlindungi' },
  'account.storageBestEffort': { en: 'not guaranteed', id: 'tidak dijamin' },

  // A teammate's edit replacing yours. The previous text is already kept in the
  // history table; this is what tells a person it happened.
  'overwrite.title': {
    en: 'A teammate’s edit replaced your answer',
    id: 'Suntingan rekan tim menggantikan jawaban Anda',
  },
  'overwrite.where': { en: 'in {where}', id: 'di {where}' },
  'overwrite.undo': { en: 'Restore mine', id: 'Kembalikan milik saya' },
  'overwrite.view': { en: 'View', id: 'Lihat' },
  'overwrite.dismiss': { en: 'Dismiss', id: 'Tutup' },
  'overwrite.restored': { en: 'Your answer is back.', id: 'Jawaban Anda telah dikembalikan.' },
} satisfies Record<string, UiEntry>

export type UiKey = keyof typeof UI

/** Values substituted into a `{placeholder}` in a chrome string. */
export type UiVars = Record<string, string | number>

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left standing rather
 * than blanked, so a missing variable shows up as a visible `{language}` in review
 * instead of a sentence with a hole in it.
 */
function interpolate(template: string, vars?: UiVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

/** A chrome string in `locale`, falling back to English. */
export function t(locale: Locale, key: UiKey, vars?: UiVars): string {
  const entry: UiEntry = UI[key]
  const template = locale === SOURCE_LOCALE ? entry.en : entry[locale] ?? entry.en
  return interpolate(template, vars)
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
