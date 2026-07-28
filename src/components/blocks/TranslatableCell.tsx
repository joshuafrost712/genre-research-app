import { AutosaveText } from './AutosaveText'
import { useLocale } from '../../lib/i18n/LocaleContext'
import { LOCALE_SHORT } from '../../lib/i18n/locales'
import { useAnswerTranslation } from '../../lib/translate/useAnswerTranslation'
import type { Entry } from '../../lib/types'

/**
 * A table or grid cell answer plus its translation, in a tighter frame than
 * `TranslatableField`.
 *
 * Cells are where most of the data actually is: a filled genre runs to roughly two
 * hundred cell answers against fifty-odd long-text ones, so leaving cells
 * monolingual would have made the feature look finished while missing the bulk of
 * what a team writes and a consultant needs to read.
 *
 * Compact on purpose. A cell is reached by expanding one field at a time, but the
 * row above it stays visible, so this keeps to a single line of controls and shows
 * the target language as a short code (`ID`) rather than a sentence.
 */
export function TranslatableCell({
  entry,
  nodeId,
  multiline,
  question,
  onSaveSource,
}: {
  entry: Entry | null | undefined
  nodeId: string
  multiline?: boolean
  /** The column label, which is the disambiguating context for a terse cell. */
  question?: string
  onSaveSource: (next: string) => void | Promise<unknown>
}) {
  const { t } = useLocale()
  const { target, canTranslate, existing, phase, note, run, saveEdit } = useAnswerTranslation(
    entry,
    nodeId,
    question,
  )

  return (
    <div className="flex flex-col gap-1">
      <AutosaveText value={entry?.text ?? ''} multiline={multiline} onSave={onSaveSource} />

      {canTranslate && target && (
        <div className="rounded border border-sky-200 bg-sky-50/50 px-1.5 py-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-800">
              {LOCALE_SHORT[target] ?? target}
            </span>
            {phase === 'working' && (
              <span className="text-[10px] text-gray-500">{t('translate.inFlight')}</span>
            )}
            {phase === 'queued' && (
              <span className="text-[10px] font-medium text-amber-800">{t('translate.queued')}</span>
            )}
            {phase === 'failed' && (
              <span className="text-[10px] text-gray-500" title={note ?? undefined}>
                {t('translate.failed')}
              </span>
            )}
            {phase !== 'working' && (
              <button
                type="button"
                onClick={run}
                className="ml-auto text-[10px] text-sky-800 underline decoration-sky-300 hover:text-sky-900"
              >
                {existing || phase === 'failed' ? t('translate.retry') : t('translate.action')}
              </button>
            )}
          </div>

          {existing !== undefined && (
            <div className="mt-1">
              <AutosaveText value={existing} multiline={multiline} onSave={saveEdit} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
