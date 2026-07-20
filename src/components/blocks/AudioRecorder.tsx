import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/storage/db'
import { now, uid } from '../../lib/util'
import type { ActiveContext } from '../../lib/storage/appState'
import type { Recording } from '../../lib/types'

/**
 * Voice recording for the first draft (2e). In oral contexts a spoken or sung
 * draft is often the real draft; this records takes on-device (MediaRecorder →
 * IndexedDB blob), plays them back, and downloads them as files. Recordings
 * attach to the active translation worksheet (the passage-and-genre pairing).
 */
export function AudioRecorderBlock({ ctx, nodeId }: { ctx: ActiveContext; nodeId: string }) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const takes = useLiveQuery(
    () =>
      db.recordings
        .where('worksheet_id')
        .equals(ctx.worksheetId)
        .and((r) => r.node_id === nodeId)
        .sortBy('created_at'),
    [ctx.worksheetId, nodeId],
  )

  // Stop cleanly if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices && 'MediaRecorder' in window

  const start = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm', 'audio/mp4', ''].find(
        (t) => !t || MediaRecorder.isTypeSupported(t),
      )
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const type = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        if (blob.size > 0) {
          const rec: Recording = {
            id: uid(),
            project_id: ctx.projectId,
            worksheet_id: ctx.worksheetId,
            node_id: nodeId,
            mime_type: type,
            blob,
            duration_sec: Math.round((Date.now() - startedAtRef.current) / 1000),
            created_at: now(),
          }
          await db.recordings.put(rec)
        }
      }
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      recorder.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(
        () => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)),
        500,
      )
    } catch {
      setError('Could not use the microphone. Check the browser permission and try again.')
    }
  }

  const stop = () => {
    recorderRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setRecording(false)
  }

  if (!supported) {
    return (
      <p className="text-xs text-gray-500">
        This device or browser cannot record audio here. You can still dictate into the text box
        above, or record with another app.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            ■ Stop <span className="tabular-nums">{formatTime(elapsed)}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            <span className="text-red-400">●</span> Record a take
          </button>
        )}
        {recording && <span className="text-xs text-red-600">Recording…</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {(takes ?? []).length > 0 && (
        <ul className="flex flex-col gap-2">
          {(takes ?? []).map((t, i) => (
            <TakeRow key={t.id} take={t} index={i} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TakeRow({ take, index }: { take: Recording; index: number }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const u = URL.createObjectURL(take.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [take.blob])

  const ext = take.mime_type.includes('mp4') ? 'm4a' : 'webm'
  const filename = `draft-take-${index + 1}.${ext}`

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
      <span className="text-xs font-medium text-gray-600">
        Take {index + 1}
        {take.duration_sec != null && (
          <span className="ml-1 text-gray-400">· {formatTime(take.duration_sec)}</span>
        )}
      </span>
      {url && <audio controls src={url} className="h-8 max-w-full flex-1" preload="metadata" />}
      <a href={url} download={filename} className="text-xs text-sky-700 hover:underline">
        Download
      </a>
      <button
        type="button"
        onClick={() => {
          if (window.confirm('Delete this take? This cannot be undone.')) {
            void db.recordings.delete(take.id)
          }
        }}
        className="text-xs text-gray-400 hover:text-red-600"
      >
        Delete
      </button>
    </li>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
