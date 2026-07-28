import { useEffect, useState } from 'react'
import { AutosaveText } from './AutosaveText'
import { findSourceNode } from '../../lib/content/loader'
import { useLocale } from '../../lib/i18n/LocaleContext'
import { LOCALE_LABELS } from '../../lib/i18n/locales'
import { entryTranslation, saveEntryTranslation } from '../../lib/storage/entries'
import { translateText } from '../../lib/translate/client'
import type { Entry } from '../../lib/types'

type Phase = 'idle' | 'working' | 'queued' | 'failed'

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
 * Storage rule this relies on: editing the source answer clears the cached
 * translation (see upsertEntry), so the two can never drift apart silently.
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
  const { answerTarget, t } = useLocale()
  const [phase, setPhase] = useState<Phase>('idle')
  const [note, setNote] = useState<string | null>(null)

  const source = entry?.text ?? ''
  const sourceLanguage = entry?.source_language ?? 'en'
  const existing = entryTranslation(entry, answerTarget)

  // A new answer means any previous state is about text that no longer exists.
  useEffect(() => {
    setPhase('idle')
    setNote(null)
  }, [entry?.id, source])

  const alreadyInTarget = sourceLanguage === answerTarget
  const canTranslate = source.trim().length > 0 && !alreadyInTarget

  async function run() {
    setPhase('working')
    setNote(null)
    const outcome = await translateText({
      text: source,
      targetLocale: answerTarget,
      // The ENGLISH question, deliberately: the contract treats it as context in a
      // known language, so a localised label would muddle the disambiguation.
      question: findSourceNode(nodeId)?.node.label,
      entryId: entry?.id,
    })

    if (outcome.status === 'translated' || outcome.status === 'unchanged') {
      if (entry?.id && outcome.text) await saveEntryTranslation(entry.id, answerTarget, outcome.text)
      setPhase('idle')
      if (outcome.status === 'unchanged') setNote(t('translate.editHint'))
      return
    }
    if (outcome.status === 'queued') {
      setPhase('queued')
      return
    }
    setPhase('failed')
    setNote(outcome.reason ?? null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <AutosaveText
        value={source}
        multiline={multiline}
        placeholder={placeholder}
        onSave={onSaveSource}
      />

      {canTranslate && (
        <div className="rounded-md border border-sky-100 bg-sky-50/60 p-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-gray-600">
              {t('translate.translationLabel')} · {LOCALE_LABELS[answerTarget] ?? answerTarget}
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
              <AutosaveText
                value={existing}
                multiline={multiline}
                onSave={(v) => {
                  if (entry?.id) return saveEntryTranslation(entry.id, answerTarget, v)
                }}
              />
              <p className="mt-1 text-[10px] text-gray-400">{t('translate.editHint')}</p>
            </>
          ) : (
            phase !== 'working' &&
            phase !== 'queued' && (
              <p className="text-[11px] text-gray-500">
                {phase === 'failed' ? t('translate.failed') : t('translate.editHint')}
              </p>
            )
          )}

          {note && phase === 'failed' && (
            <p className="mt-1 text-[10px] text-gray-400" title={note}>
              {note.slice(0, 120)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
