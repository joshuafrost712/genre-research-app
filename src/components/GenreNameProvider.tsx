import { createContext, useContext, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from './ActiveContextProvider'

/**
 * Supplies the active genre's and focus text's names to the renderer so prompts
 * can address them by name instead of repeating "this genre" / "your passage".
 * Katie's note: across several genres a researcher loses track of which one a
 * question is about, so we splice the real name into the prompt text at render
 * time (no LLM, no stored copy).
 */
export interface NameTokens {
  genre: string
  passage: string
}

const NameTokensContext = createContext<NameTokens>({ genre: '', passage: '' })

export function GenreNameProvider({ children }: { children: ReactNode }) {
  const { ctx } = useActiveContext()
  const tokens = useLiveQuery(
    async () => {
      if (!ctx) return { genre: '', passage: '' }
      const [genre, focusText] = await Promise.all([
        db.genres.get(ctx.genreId),
        db.focusTexts.get(ctx.focusTextId),
      ])
      return { genre: genre?.name ?? '', passage: focusText?.reference ?? '' }
    },
    [ctx?.genreId, ctx?.focusTextId],
  )
  return (
    <NameTokensContext.Provider value={tokens ?? { genre: '', passage: '' }}>
      {children}
    </NameTokensContext.Provider>
  )
}

export function useGenreName(): string {
  return useContext(NameTokensContext).genre
}

export function useNameTokens(): NameTokens {
  return useContext(NameTokensContext)
}

/**
 * Replace the `{genre}` and `{passage}` tokens with the active names, falling
 * back to "this genre" / "your passage" when still unnamed (so a placeholder
 * never leaks "Untitled genre" into a prompt). Accepts either the genre name
 * alone (the common case) or the full token pair.
 */
export function resolveGenreTokens(text: string | undefined, names: string | NameTokens): string {
  if (!text) return text ?? ''
  const tokens: NameTokens = typeof names === 'string' ? { genre: names, passage: '' } : names
  let out = text
  if (out.includes('{genre}')) {
    const usable =
      tokens.genre && !tokens.genre.startsWith('Untitled') ? tokens.genre : 'this genre'
    out = out.replaceAll('{genre}', usable)
  }
  if (out.includes('{passage}')) {
    const usable =
      tokens.passage && !tokens.passage.startsWith('Untitled') ? tokens.passage : 'your passage'
    out = out.replaceAll('{passage}', usable)
  }
  return out
}
