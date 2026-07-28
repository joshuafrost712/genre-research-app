/**
 * Active-locale provider.
 *
 * Mirrors `components/DepthModeContext.tsx`: React context plus `localStorage`
 * persistence, no external state library. The locale is a device preference, not
 * project data, so it is deliberately NOT synced — a facilitator reviewing in
 * English and a team working in Indonesian can share a project without fighting
 * over one setting.
 *
 * Also keeps the document's `lang` attribute in step, which drives the correct
 * hyphenation and, more importantly, the right voice when a screen reader or the
 * OS reads the page aloud.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_TRANSLATION_TARGET } from '../translate/config'
import { partnerLocale } from '../translate/direction'
import { setActiveLocale } from './activeLocale'
import { isLocale, SOURCE_LOCALE, type Locale } from './locales'
import { t as translateChrome, type UiKey, type UiVars } from './strings'

interface LocaleContextValue {
  /** The language the UI is rendered in. */
  locale: Locale
  setLocale: (locale: Locale) => void
  /** True when the UI is showing the untranslated source language. */
  isSource: boolean
  /** Chrome-string lookup bound to the active locale. */
  t: (key: UiKey, vars?: UiVars) => string
  /**
   * "The other language" from where the reader is standing: the configured target
   * while working in English, English while working in a translated UI. Used for
   * the bilingual export's second column and as a default where no specific answer
   * is in view. A specific answer instead uses `translationTargetFor`, which also
   * accounts for the language that answer was written in.
   */
  answerTarget: Locale
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

const STORAGE_KEY = 'locale'

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
    // No stored choice: honour the device language when the app supports it, so
    // an Indonesian-configured phone opens in Indonesian without being told to.
    const device = navigator.language?.split('-')[0]
    return isLocale(device) ? device : SOURCE_LOCALE
  })

  // Mirror to module state DURING render, not in an effect: the loader reads it
  // synchronously, so descendants rendering in this same pass must already see the
  // new locale or the first paint after a switch would show the old language.
  setActiveLocale(locale)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const t = useCallback((key: UiKey, vars?: UiVars) => translateChrome(locale, key, vars), [locale])

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      isSource: locale === SOURCE_LOCALE,
      t,
      answerTarget: partnerLocale(locale) ?? DEFAULT_TRANSLATION_TARGET,
    }),
    [locale, t],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider')
  return ctx
}
