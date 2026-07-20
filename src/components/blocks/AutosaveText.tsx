import { useEffect, useRef, useState } from 'react'

/**
 * Controlled text input that autosaves on a short debounce. Local state owns the
 * keystrokes; it adopts an externally-changed value only while unfocused, so a
 * live-query refresh never clobbers what the facilitator is typing.
 *
 * Multiline boxes grow with their content (feedback 2026-07-20 #14/#15): the
 * height follows scrollHeight while typing, and an empty box reserves enough
 * rows for its placeholder so example text is never clipped.
 */
export function AutosaveText({
  value,
  onSave,
  multiline = false,
  placeholder,
  debounceMs = 400,
}: {
  value: string
  onSave: (next: string) => void | Promise<unknown>
  multiline?: boolean
  placeholder?: string
  debounceMs?: number
}) {
  const [local, setLocal] = useState(value)
  const [saved, setSaved] = useState(false)
  const focused = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  // Adopt external changes only when not actively editing.
  useEffect(() => {
    if (!focused.current) setLocal(value)
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  // Grow the textarea to fit whatever is in it.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [local, multiline])

  const scheduleSave = (next: string) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      await onSave(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    }, debounceMs)
  }

  const handleChange = (next: string) => {
    setLocal(next)
    scheduleSave(next)
  }

  const flush = () => {
    focused.current = false
    clearTimeout(timer.current)
    if (local !== value) {
      void onSave(local)
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    }
  }

  const shared = {
    value: local,
    placeholder,
    onFocus: () => (focused.current = true),
    onBlur: flush,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      handleChange(e.target.value),
    className:
      'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none',
  }

  // An empty box shows its placeholder; reserve roughly enough rows for it
  // (scrollHeight cannot see placeholder text, so estimate ~50 chars per line).
  const placeholderRows =
    !local && placeholder ? Math.min(6, Math.max(3, Math.ceil(placeholder.length / 50))) : 3

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          rows={placeholderRows}
          ref={areaRef}
          {...shared}
          className={`${shared.className} resize-none overflow-hidden`}
        />
      ) : (
        <input type="text" {...shared} />
      )}
      {saved && (
        <span className="absolute right-2 top-2 text-[10px] text-emerald-600">saved</span>
      )}
    </div>
  )
}
