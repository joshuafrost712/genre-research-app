/**
 * Save a copy of everything on this device, and put one back.
 *
 * Separate from the report exports it sits beside, because it answers a different
 * question. The CSV, Word and PDF buttons above it export the ACTIVE project and
 * are shaped for a reader: headings, one row per answered cell, a document
 * somebody opens. This is shaped for a disaster: every table, every project, in a
 * form the app can read back. A device can hold more than one project and the
 * report exports only ever see one, so a person who used them as a backup would
 * be missing work and would have no way to tell.
 *
 * It also states the durability answer, which is the other half of why the Bali
 * notes were lost. `AccountMenu` shows that answer only to someone signed in, and
 * a guest is precisely the person whose work has nowhere else to be. Here it sits
 * next to the button that does something about it.
 */
import { useRef, useState } from 'react'
import {
  BackupFormatError,
  parseBackup,
  restoreBackup,
  saveBackupFile,
  type BackupFile,
} from '../../lib/storage/backup'
import { useStorageState } from '../../lib/storage/durability'
import { useLocale } from '../../lib/i18n/LocaleContext'

type State =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; counts: BackupFile['counts'] }
  | { status: 'restoring' }
  | { status: 'restored'; total: number }
  | { status: 'error'; message: string }

export function BackupPanel() {
  const { t } = useLocale()
  const { risk, ready } = useStorageState()
  const [state, setState] = useState<State>({ status: 'idle' })
  const fileInput = useRef<HTMLInputElement | null>(null)

  const save = async () => {
    setState({ status: 'saving' })
    try {
      const file = await saveBackupFile()
      setState({ status: 'saved', counts: file.counts })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const restore = async (file: File) => {
    setState({ status: 'restoring' })
    try {
      const parsed = parseBackup(await file.text())
      const result = await restoreBackup(parsed)
      setState({ status: 'restored', total: result.total })
    } catch (e) {
      // A wrong file picked from a crowded Files app is the common case, so the
      // format error's own message is shown; anything else gets the generic line.
      setState({
        status: 'error',
        message: e instanceof BackupFormatError ? e.message : t('backup.failed'),
      })
    } finally {
      // Clear the input, or picking the same file twice in a row does nothing and
      // reads as the button being broken.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">{t('backup.title')}</h2>
        <p className="mt-1 text-xs text-gray-500">{t('backup.body')}</p>
        {ready && (
          <p className="mt-1 text-xs text-gray-400">
            {t('account.storageLabel')}:{' '}
            {risk === 'protected'
              ? t('account.storageProtected')
              : t('account.storageBestEffort')}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={state.status === 'saving'}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {state.status === 'saving' ? t('storage.saving') : t('backup.save')}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={state.status === 'restoring'}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40"
        >
          {t('backup.restore')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void restore(file)
          }}
        />
      </div>

      {state.status === 'saved' && (
        <p className="text-xs text-emerald-700">
          {t('storage.saved')}{' '}
          {Object.entries(state.counts)
            .filter(([, n]) => n > 0)
            .map(([table, n]) => `${table}: ${n}`)
            .join(' · ')}
        </p>
      )}
      {state.status === 'restored' && (
        <p className="text-xs text-emerald-700">
          {state.total > 0 ? t('backup.restored', { n: state.total }) : t('backup.nothing')}
        </p>
      )}
      {state.status === 'error' && <p className="text-xs text-red-600">{state.message}</p>}
    </div>
  )
}
