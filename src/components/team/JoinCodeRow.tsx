/**
 * The join code, with a way to copy it.
 *
 * Shown wherever a person might be asked "what's your code?" — Home and the team
 * page — rather than only on the page they have to go looking for.
 */
import { useState } from 'react'

export function JoinCodeRow({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard?.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded bg-gray-100 px-2 py-1 text-sm font-medium select-all">{code}</code>
      <button
        type="button"
        onClick={copy}
        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
