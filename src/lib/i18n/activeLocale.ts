/**
 * The active locale as module state, alongside the React context.
 *
 * Why both: worksheet content is read from ~50 call sites, and several of them are
 * plain modules with no access to React context — `lib/export.ts` builds the report,
 * `lib/progress.ts` computes completion, `routing/operations.ts` builds the AI
 * routing manifest. Threading a locale argument through all of them (and through
 * every component that calls them) would be a large, error-prone diff for no gain.
 *
 * So `LocaleProvider` mirrors its state here and the loader reads it, the same
 * approach i18next takes. Two consequences worth knowing:
 *
 *  - React will not re-render a component just because this changed. `Layout` keys
 *    its subtree on the locale so a language switch remounts the pages and every
 *    consumer re-reads. Switching language is a rare, deliberate action, so a
 *    remount is cheap; and because the switcher takes focus first, `AutosaveText`
 *    has already flushed any pending keystrokes on blur.
 *  - Tests must set this explicitly rather than relying on a provider.
 */
import { SOURCE_LOCALE, type Locale } from './locales'

let active: Locale = SOURCE_LOCALE

export function getActiveLocale(): Locale {
  return active
}

export function setActiveLocale(locale: Locale): void {
  active = locale
}
