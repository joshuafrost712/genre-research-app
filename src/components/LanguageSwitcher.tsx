import { LOCALES, LOCALE_LABELS, LOCALE_SHORT } from '../lib/i18n/locales'
import { useLocale } from '../lib/i18n/LocaleContext'

/**
 * Header language switcher.
 *
 * A native `<select>` on purpose: it is keyboard- and screen-reader-accessible for
 * free, renders as the platform picker on a phone (easier to hit than custom chips
 * with a facilitator's device passed around a room), and scales past two languages
 * without a layout change. Options are labelled with each language's own endonym so
 * a team member can find theirs without reading English.
 */
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale()

  // One language configured means nothing to switch between; render nothing rather
  // than a dead control.
  if (LOCALES.length < 2) return null

  return (
    <label className="flex shrink-0 items-center gap-1" title={t('lang.switchTo')}>
      <span className="sr-only">{t('lang.label')}</span>
      <span aria-hidden className="text-xs text-gray-400">
        {LOCALE_SHORT[locale]}
      </span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
        aria-label={t('lang.label')}
        className="max-w-[8rem] truncate rounded border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700 focus:border-gray-500 focus:outline-none"
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
