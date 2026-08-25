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
  // Singular, and second in the menu rather than last. "Teams" plural read as a
  // directory of other people's teams; what people want is the one they are in.
  'nav.team': { en: 'Team', id: 'Tim' },
  'nav.openMenu': { en: 'Open menu', id: 'Buka menu' },
  'nav.quickLinks': { en: 'Shortcuts', id: 'Pintasan' },
  'nav.progress': { en: 'Progress', id: 'Kemajuan' },
  'nav.depth': { en: 'Depth', id: 'Kedalaman' },
  'nav.workspace': { en: 'Workspace {n}', id: 'Ruang Kerja {n}' },

  // The jot picker: insert a captured note into the answer box it belongs in.
  'jot.insert': { en: 'Insert a jot', id: 'Sisipkan catatan' },
  'jot.pickerTitle': { en: 'Insert a jot', id: 'Sisipkan catatan' },
  'jot.pickerHint': {
    en: 'Tap a jot to insert it here. It stays available for other boxes too.',
    id: 'Ketuk catatan untuk menyisipkannya di sini. Catatan tetap tersedia untuk kotak lain.',
  },
  'jot.search': { en: 'Search jots…', id: 'Cari catatan…' },
  'jot.used': { en: 'used ×{n}', id: 'dipakai ×{n}' },
  'jot.insertHere': { en: 'Insert', id: 'Sisipkan' },
  'jot.inserted': { en: 'Inserted ✓', id: 'Tersisip ✓' },
  'jot.archive': { en: 'Archive', id: 'Arsipkan' },
  'jot.archivedRow': { en: 'Archived.', id: 'Diarsipkan.' },
  'jot.undo': { en: 'Undo', id: 'Urungkan' },
  'jot.you': { en: 'You', id: 'Anda' },
  'jot.empty': {
    en: 'No jots yet. Tap the ✎ Jot button to capture a stray answer.',
    id: 'Belum ada catatan. Ketuk tombol ✎ Jot untuk menangkap jawaban yang melenceng.',
  },
  'jot.done': { en: 'Done', id: 'Selesai' },

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

  // Storage that the browser has not promised to keep. Written after a Bali
  // participant opened the app from a chat link on an iPhone, typed a session's
  // notes, and found the app empty: it knew his storage was disposable and had no
  // way to say so. The copy names the risk and offers the two things that end it,
  // in the order of least commitment.
  'storage.atRisk': {
    en: 'Your work is saved on this phone only. This browser may delete it. Save a backup file, or sign in to keep it safe.',
    id: 'Pekerjaan Anda hanya tersimpan di ponsel ini. Peramban ini bisa menghapusnya. Simpan berkas cadangan, atau masuk agar tetap aman.',
  },
  // Hedged on purpose. The device looks emptied and a mark says work was here,
  // but the app cannot prove what emptied it, so it must not accuse.
  'storage.lost': {
    en: 'Work saved here earlier is not on this device now. This browser may be deleting it. Save a backup file, or sign in to keep your work safe.',
    id: 'Pekerjaan yang tersimpan sebelumnya sudah tidak ada di perangkat ini. Peramban ini mungkin menghapusnya. Simpan berkas cadangan, atau masuk agar pekerjaan Anda aman.',
  },
  'storage.inAppBrowser': {
    en: 'You are in another app’s browser, which keeps its own separate copy. Tap the ⋯ menu, choose Open in Safari, then Add to Home Screen so your work is kept.',
    id: 'Anda berada di peramban dalam aplikasi lain, yang menyimpan salinannya sendiri. Ketuk menu ⋯, pilih Buka di Safari, lalu Tambahkan ke Layar Utama agar pekerjaan Anda tersimpan.',
  },
  'storage.saveBackup': { en: 'Save backup', id: 'Simpan cadangan' },
  'storage.saving': { en: 'Saving…', id: 'Menyimpan…' },
  'storage.saved': { en: 'Backup saved.', id: 'Cadangan tersimpan.' },
  'storage.signIn': { en: 'Sign in', id: 'Masuk' },

  // The whole-device backup on the Export page.
  'backup.title': {
    en: 'Backup of everything on this device',
    id: 'Cadangan seluruh isi perangkat ini',
  },
  'backup.body': {
    en: 'One file holding every project, passage, genre, answer and note on this device, including projects the export above does not cover. Voice recordings are not included. Keep it somewhere safe, or use it to move your work to another device.',
    id: 'Satu berkas yang memuat semua proyek, perikop, genre, jawaban, dan catatan di perangkat ini, termasuk proyek yang tidak tercakup ekspor di atas. Rekaman suara tidak disertakan. Simpan di tempat yang aman, atau gunakan untuk memindahkan pekerjaan Anda ke perangkat lain.',
  },
  'backup.save': { en: 'Save backup file', id: 'Simpan berkas cadangan' },
  'backup.restore': { en: 'Restore from a backup file', id: 'Pulihkan dari berkas cadangan' },
  'backup.restored': { en: 'Restored {n} records.', id: 'Memulihkan {n} catatan.' },
  'backup.nothing': {
    en: 'That backup had nothing to restore.',
    id: 'Tidak ada yang bisa dipulihkan dari cadangan itu.',
  },
  'backup.failed': { en: 'Could not restore that file.', id: 'Tidak bisa memulihkan berkas itu.' },

  // Handing a device from one person to another.
  'account.switchedTo': {
    en: 'Starting fresh for {email}. The previous account’s work is safe in that account.',
    id: 'Memulai dari awal untuk {email}. Pekerjaan akun sebelumnya aman di akun tersebut.',
  },
  'account.deviceHolds': {
    en: 'This device holds {email}’s work.',
    id: 'Perangkat ini menyimpan pekerjaan {email}.',
  },
  'account.clearDevice': { en: 'Clear this device', id: 'Bersihkan perangkat ini' },
  'account.dismiss': { en: 'Dismiss', id: 'Tutup' },

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

  // Teams. The workshop failure these exist to fix: every shared worksheet read
  // "Untitled project", so nobody could tell which team's data they were in, and
  // several teams gave up on the feature. One word — "team" — is used for it
  // everywhere now; the menu, the header and the page used to say three different
  // things. Team NAMES themselves are free text in whatever language people type.
  'team.nameless': { en: 'Team with no name yet', id: 'Tim yang belum diberi nama' },
  'team.solo': { en: 'Just you — not shared', id: 'Hanya Anda — belum dibagikan' },
  'team.people': { en: '{n} people', id: '{n} orang' },
  // The bare noun, for the header chip: on a phone it shows "· 4" and the word
  // only appears once there is room for it.
  'team.peopleWord': { en: 'people', id: 'orang' },
  'team.justYou': { en: 'just you', id: 'hanya Anda' },
  'team.openTeamPage': { en: 'Open the team page', id: 'Buka halaman tim' },

  // The drift warning. This is the one Joshua asked for by name: nobody should be
  // unsure whether their typing reaches the team or a private copy.
  'team.driftTitle': {
    en: 'You are working in your own worksheet.',
    id: 'Anda sedang bekerja di lembar kerja pribadi Anda.',
  },
  'team.driftBody': {
    en: 'Nothing you type here reaches your team.',
    id: 'Apa pun yang Anda tulis di sini tidak sampai ke tim Anda.',
  },
  'team.driftOpen': { en: 'Open {name}', id: 'Buka {name}' },

  // Provenance, shown where people add things.
  'team.belongsTo': {
    en: 'These passages and genres belong to {name} ({people}). Anything you add here goes to that team.',
    id: 'Perikop dan genre ini milik {name} ({people}). Apa pun yang Anda tambahkan di sini masuk ke tim itu.',
  },
  'team.belongsToSolo': {
    en: 'These passages and genres are in your own worksheet ({people}). Nothing here is shared with a team.',
    id: 'Perikop dan genre ini ada di lembar kerja pribadi Anda ({people}). Tidak ada yang dibagikan ke tim.',
  },
  'team.addGenreTo': { en: 'Add genre to {name}', id: 'Tambahkan genre ke {name}' },

  // First-run onboarding gate. Plain and Google-Translate-robust, like the
  // tours. Never the word "workspace" for the project/team container — that
  // word belongs to the Workspace 1/2 methodology phases.
  'onboard.title': {
    en: 'Welcome — set up your research',
    id: 'Selamat datang — siapkan penelitian Anda',
  },
  'onboard.lead': {
    en: 'This app documents the songs, poems, stories and other genres of one culture in one language. Choose how to begin.',
    id: 'Aplikasi ini mendokumentasikan lagu, puisi, cerita, dan genre lain dari satu budaya dalam satu bahasa. Pilih cara memulai.',
  },
  'onboard.joinTeam': { en: 'Join a team', id: 'Gabung tim' },
  'onboard.joinTeamHint': {
    en: 'Someone gave you a team code. Joining needs the internet.',
    id: 'Anda menerima kode tim. Bergabung memerlukan internet.',
  },
  'onboard.startProject': { en: 'Start a new project', id: 'Mulai proyek baru' },
  'onboard.startProjectHint': {
    en: 'Document the genres of one culture in one language. Works without internet.',
    id: 'Dokumentasikan genre satu budaya dalam satu bahasa. Bisa tanpa internet.',
  },
  'onboard.haveAccount': {
    en: 'Used this app before on another device? Sign in',
    id: 'Pernah memakai aplikasi ini di perangkat lain? Masuk',
  },
  'onboard.cultureLabel': {
    en: "Which culture's genres will you document?",
    id: 'Genre budaya mana yang akan Anda dokumentasikan?',
  },
  'onboard.culturePlaceholder': { en: 'Example: Common USA', id: 'Contoh: Jawa pesisir' },
  'onboard.languageLabel': { en: 'In which language?', id: 'Dalam bahasa apa?' },
  'onboard.languagePlaceholder': {
    en: 'Example: American English',
    id: 'Contoh: bahasa Jawa',
  },
  'onboard.nameTemplate': {
    en: '{culture} genres in {language}',
    id: 'Genre {culture} dalam bahasa {language}',
  },
  'onboard.namePreview': {
    en: 'Your project will be called: {name}',
    id: 'Proyek Anda akan bernama: {name}',
  },
  'onboard.changeLater': {
    en: 'You can change this later on the Team page.',
    id: 'Anda dapat mengubahnya nanti di halaman Tim.',
  },
  'onboard.start': { en: 'Start', id: 'Mulai' },
  'onboard.back': { en: 'Back', id: 'Kembali' },
  'onboard.enterCode': {
    en: 'Type your team code',
    id: 'Ketik kode tim Anda',
  },
  'onboard.join': { en: 'Join', id: 'Gabung' },
  'onboard.offlineJoin': {
    en: 'No connection right now. Joining a team needs the internet — you can start a project on this device instead.',
    id: 'Tidak ada koneksi saat ini. Bergabung dengan tim memerlukan internet — Anda bisa mulai proyek di perangkat ini.',
  },
  'onboard.checkingCloud': {
    en: 'Signed in as {email} — looking for work saved to your account…',
    id: 'Masuk sebagai {email} — mencari pekerjaan yang tersimpan di akun Anda…',
  },
  'onboard.signInInstead': {
    en: 'Already have an account? Sign in',
    id: 'Sudah punya akun? Masuk',
  },

  // Culture/language scope fields (Team page + Dashboard backfill card).
  'scope.cultureLabel': { en: 'Culture', id: 'Budaya' },
  'scope.languageLabel': { en: 'Language of study', id: 'Bahasa yang diteliti' },
  'scope.promptTitle': {
    en: 'Which culture and language is this project about?',
    id: 'Proyek ini tentang budaya dan bahasa apa?',
  },
  'scope.promptBody': {
    en: 'Naming them helps your team and appears in exports.',
    id: 'Menamainya membantu tim Anda dan muncul di ekspor.',
  },
  'scope.teamScopeHint': {
    en: 'This team documents {culture} genres in {language}.',
    id: 'Tim ini mendokumentasikan genre {culture} dalam bahasa {language}.',
  },
  'scope.alsoRename': {
    en: 'Also name the project "{name}"',
    id: 'Juga beri nama proyek "{name}"',
  },
  'scope.save': { en: 'Save', id: 'Simpan' },
  'scope.later': { en: 'Later', id: 'Nanti' },
  'scope.saved': { en: 'Saved.', id: 'Tersimpan.' },
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
