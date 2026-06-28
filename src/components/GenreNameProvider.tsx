import { createContext, useContext, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from './ActiveContextProvider'

/**
 * Supplies the active genre's name to the renderer so prompts can address the
 * genre by name instead of repeating "this genre". Katie's note: across several
 * genres a researcher loses track of which one a question is about, so we splice
 * the real name into the prompt text at render time (no LLM, no stored copy).
 */
const GenreNameContext = createContext<string>('')

export function GenreNameProvider({ children }: { children: ReactNode }) {
  const { ctx } = useActiveContext()
  const name = useLiveQuery(
    async () => (ctx ? ((await db.genres.get(ctx.genreId))?.name ?? '') : ''),
    [ctx?.genreId],
  )
  return <GenreNameContext.Provider value={name ?? ''}>{children}</GenreNameContext.Provider>
}

export function useGenreName(): string {
  return useContext(GenreNameContext)
}

/**
 * Replace the `{genre}` token with the active genre's name, falling back to
 * "this genre" when the genre is still unnamed (so a placeholder never leaks
 * "Untitled genre" into a prompt).
 */
export function resolveGenreTokens(text: string | undefined, genreName: string): string {
  if (!text) return text ?? ''
  if (!text.includes('{genre}')) return text
  const usable = genreName && !genreName.startsWith('Untitled') ? genreName : 'this genre'
  return text.replaceAll('{genre}', usable)
}
