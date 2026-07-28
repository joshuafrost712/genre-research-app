/**
 * The translation behaviour of a single answer, with no opinion about how it looks.
 *
 * Two very different presentations need identical logic: the roomy box under a
 * long-text question, and the compact line inside a table cell where roughly two
 * hundred answers per genre actually live. Duplicating the staleness and
 * direction rules across both would be the obvious way to let them drift, so the
 * rules live here once and the components only draw.
 */
import { useEffect, useState } from 'react'
import { findSourceNode } from '../content/loader'
import { useLocale } from '../i18n/LocaleContext'
import { type Locale } from '../i18n/locales'
import { entryTranslation, saveEntryTranslation } from '../storage/entries'
import { translateText, type QueuedCause } from './client'
import { translationTargetFor } from './direction'
import type { UiKey } from '../i18n/strings'
import type { Entry } from '../types'

/**
 * What to tell someone whose translation was deferred.
 *
 * 'lane' and 'unknown' fall through to the bare "Queued" line: in the first case
 * deferral is the configured intent and not worth explaining twice, and in the
 * second there is nothing honest to add.
 */
const QUEUED_NOTE: Partial<Record<QueuedCause, UiKey>> = {
  'signed-out': 'translate.queuedSignIn',
  'needs-tester-link': 'translate.queuedNeedsTesterLink',
  'not-configured': 'translate.queuedNotConfigured',
  busy: 'translate.queuedBusy',
  offline: 'translate.queuedOffline',
}

export type TranslationPhase = 'idle' | 'working' | 'queued' | 'failed'

export interface AnswerTranslation {
  /** The language this answer would be translated into, or null if there is none. */
  target: Locale | null
  /** True when there is source text and a language to translate it into. */
  canTranslate: boolean
  /** The stored translation, or undefined if there is not one yet. */
  existing: string | undefined
  phase: TranslationPhase
  /**
   * A short explanation to show alongside the phase: a localized sentence when a
   * request was deferred for a reason worth naming, or the truncated upstream
   * detail when it failed outright.
   */
  note: string | null
  /** Request a translation. Never throws; failure lands in `phase`. */
  run: () => Promise<void>
  /** Save a human edit of the translation. */
  saveEdit: (next: string) => Promise<unknown> | void
}

export function useAnswerTranslation(
  entry: Entry | null | undefined,
  nodeId: string,
  questionOverride?: string,
): AnswerTranslation {
  const { locale, t } = useLocale()
  const [phase, setPhase] = useState<TranslationPhase>('idle')
  const [note, setNote] = useState<string | null>(null)

  const source = entry?.text ?? ''
  const target = translationTargetFor(entry?.source_language, locale)
  const existing = target ? entryTranslation(entry, target) : undefined

  // A different answer, or a rewritten one, means any phase state describes text
  // that no longer exists. Resetting is what stops a stale "failed" badge from
  // haunting a field the team has since fixed.
  useEffect(() => {
    setPhase('idle')
    setNote(null)
  }, [entry?.id, source, target])

  const canTranslate = source.trim().length > 0 && target !== null

  async function run() {
    if (!target || !canTranslate) return
    setPhase('working')
    setNote(null)

    const outcome = await translateText({
      text: source,
      targetLocale: target,
      // The ENGLISH question, deliberately: the prompt contract treats it as
      // context in a known language, so a localised label would muddle rather
      // than sharpen the disambiguation of a three-word answer.
      question: questionOverride ?? findSourceNode(nodeId)?.node.label,
      entryId: entry?.id,
    })

    if (outcome.status === 'translated' || outcome.status === 'unchanged') {
      if (entry?.id && outcome.text) await saveEntryTranslation(entry.id, target, outcome.text)
      setPhase('idle')
      return
    }
    if (outcome.status === 'queued') {
      setPhase('queued')
      const key = outcome.cause ? QUEUED_NOTE[outcome.cause] : undefined
      setNote(key ? t(key) : null)
      return
    }
    setPhase('failed')
    setNote(outcome.reason ? outcome.reason.slice(0, 120) : null)
  }

  return {
    target,
    canTranslate,
    existing,
    phase,
    note,
    run,
    saveEdit: (next: string) => {
      if (entry?.id && target) return saveEntryTranslation(entry.id, target, next)
    },
  }
}
