import { LOCALES, LOCALE_LABELS, LOCALE_SHORT, type Locale } from '../lib/i18n/locales'
import { useLocale } from '../lib/i18n/LocaleContext'

/**
 * The language control, in two shapes.
 *
 * With exactly two languages configured (the real case: English and Bahasa
 * Indonesia) this is a segmented toggle showing BOTH options at once, one tap
 * apart. Joshua's requirement drove that: the people entering and reviewing data
 * are usually bilingual and switch back and forth constantly, so the control has to
 * announce what the choices are and cost one tap, not open a menu and cost three
 * interactions. A dropdown also hides the fact that another language exists at all,
 * which was the first version's real failing.
 *
 * With three or more it falls back to a native `<select>`, which stays
 * keyboard- and screen-reader-accessible, renders as the platform picker on a
 * phone, and does not grow the header without bound.
 *
 * Either shape labels options with each language's own endonym, so a team member
 * can find theirs without reading English first.
 */
export function LanguageSwitcher({ variant = 'header' }: { variant?: 'header' | 'block' }) {
  const { locale, setLocale, t } = useLocale()

  // One language configured means nothing to switch between; render nothing rather
  // than a dead control.
  if (LOCALES.length < 2) return null

  if (LOCALES.length === 2) {
    return (
      <div
        role="group"
        aria-label={t('lang.label')}
        className={`flex shrink-0 items-center gap-0.5 rounded-lg border border-gray-300 bg-gray-100 p-0.5 ${
          variant === 'block' ? 'w-full' : ''
        }`}
      >
        {LOCALES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={locale === code}
            // The full endonym on wide screens, the short code on a phone, where
            // the header competes with the context bar and the account button.
            title={LOCALE_LABELS[code]}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              variant === 'block' ? 'flex-1' : ''
            } ${
              locale === code
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            <span className={variant === 'block' ? '' : 'hidden sm:inline'}>
              {LOCALE_LABELS[code]}
            </span>
            <span className={variant === 'block' ? 'hidden' : 'sm:hidden'}>
              {LOCALE_SHORT[code]}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <label
      className={`flex shrink-0 items-center gap-1 ${variant === 'block' ? 'w-full' : ''}`}
      title={t('lang.switchTo')}
    >
      <span className="sr-only">{t('lang.label')}</span>
      <span aria-hidden className="text-xs text-gray-400">
        {LOCALE_SHORT[locale]}
      </span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t('lang.label')}
        className={`truncate rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 focus:border-gray-500 focus:outline-none ${
          variant === 'block' ? 'w-full' : 'max-w-[8rem]'
        }`}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  )
}
