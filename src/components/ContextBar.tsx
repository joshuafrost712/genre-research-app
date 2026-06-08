import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from './ActiveContextProvider'

/** Shows what the worksheet is currently editing: active focus text x genre. */
export function ContextBar() {
  const { ctx } = useActiveContext()
  const labels = useLiveQuery(async () => {
    if (!ctx) return null
    const [focusText, genre] = await Promise.all([
      db.focusTexts.get(ctx.focusTextId),
      db.genres.get(ctx.genreId),
    ])
    return { focusText: focusText?.reference ?? '—', genre: genre?.name ?? '—' }
  }, [ctx?.focusTextId, ctx?.genreId])

  if (!labels) return null

  return (
    <Link
      to="/genres"
      className="flex items-center gap-2 truncate text-xs text-gray-500 hover:text-gray-800"
      title="Switch focus text or genre"
    >
      <span className="truncate">
        <span className="text-sky-700">{labels.focusText}</span>
        <span className="mx-1 text-gray-300">×</span>
        <span className="text-emerald-700">{labels.genre}</span>
      </span>
      <span className="text-gray-300">▾</span>
    </Link>
  )
}
