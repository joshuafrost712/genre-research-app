import { AutosaveText } from './AutosaveText'
import { useLocale } from '../../lib/i18n/LocaleContext'
import { LOCALE_LABELS } from '../../lib/i18n/locales'
import { useAnswerTranslation } from '../../lib/translate/useAnswerTranslation'
import type { Entry } from '../../lib/types'

/**
 * A worksheet answer plus its translation.
 *
 * Wraps `AutosaveText` rather than modifying it: that component is used
 * everywhere, and its "adopt an external value only while unfocused" rule is the
 * reason an arriving translation cannot clobber what someone is typing.
 *
 * The translation is EDITABLE, which is the point. Machine translation of field
 * notes will be roughly right and locally wrong, and the team is the only party who
 * can fix it. It saves through the same debounced autosave as any other answer.
 *
 * Two rules it leans on, both tested elsewhere: editing the source answer clears
 * the cached translation (`upsertEntry`), so the pair cannot drift apart silently;
 * and the target language follows the reader (`translationTargetFor`), so the
 * control always offers the language you are not currently looking at.
 */
export function TranslatableField({
  entry,
  nodeId,
  multiline,
  placeholder,
  onSaveSource,
}: {
  entry: Entry | null | undefined
  nodeId: string
  multiline?: boolean
  placeholder?: string
  onSaveSource: (next: string) => void | Promise<unknown>
}) {
  const { t } = useLocale()
  const { target, canTranslate, existing, phase, note, run, saveEdit } = useAnswerTranslation(
    entry,
    nodeId,
  )

  return (
    <div className="flex flex-col gap-1.5">
      <AutosaveText
        value={entry?.text ?? ''}
        multiline={multiline}
        placeholder={placeholder}
        onSave={onSaveSource}
      />

      {canTranslate && target && (
        <div className="rounded-md border border-sky-200 bg-sky-50/60 p-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-gray-600">
              {t('translate.translationLabel')} · {LOCALE_LABELS[target] ?? target}
            </span>
            {phase === 'working' && (
              <span className="text-[10px] text-gray-500">{t('translate.inFlight')}</span>
            )}
            {phase === 'queued' && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                {t('translate.queued')}
              </span>
            )}
            {phase !== 'working' && (
              <button
                type="button"
                onClick={run}
                className="ml-auto rounded border border-sky-300 bg-white px-2 py-0.5 text-[11px] text-sky-800 hover:bg-sky-100"
              >
                {existing || phase === 'failed' ? t('translate.retry') : t('translate.action')}
              </button>
            )}
          </div>

          {existing !== undefined ? (
            <>
              <AutosaveText value={existing} multiline={multiline} onSave={saveEdit} />
              <p className="mt-1 text-[10px] text-gray-400">{t('translate.editHint')}</p>
            </>
          ) : (
            phase !== 'working' &&
            phase !== 'queued' && (
              <p className="text-[11px] text-gray-500">
                {phase === 'failed'
                  ? t('translate.failed')
                  : t('translate.offer', { language: LOCALE_LABELS[target] ?? target })}
              </p>
            )
          )}

          {note && phase === 'failed' && (
            <p className="mt-1 text-[10px] text-gray-400" title={note}>
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
