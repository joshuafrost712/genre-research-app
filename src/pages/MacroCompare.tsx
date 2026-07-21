import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/storage/db'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useDepthMode } from '../components/DepthModeContext'
import { BlockRenderer } from '../components/blocks/BlockRenderer'
import { GenreRecallPanel } from '../components/GenreRecallPanel'
import { resolveGenreTokens, useGenreName, useNameTokens } from '../components/GenreNameProvider'
import { findNode, nextNavId, routeForSub } from '../lib/content/loader'
import { setLastNode } from '../lib/storage/appState'

/**
 * 2c: The Big Picture — compare & decide. Four areas (most important parts,
 * sections, feelings, connections). In each: enter what you find in the
 * passage on the work side, while the genre's own conventions (from the 1d
 * study) display automatically beside it. Genre-side edits are possible on the
 * spot via a click-through, auto-save, and keep history.
 */
export function MacroCompare() {
  const { ctx } = useActiveContext()
  const { mode } = useDepthMode()
  const genreToken = useGenreName()
  const tokens = useNameTokens()
  const genre = useLiveQuery(
    async () => (ctx ? await db.genres.get(ctx.genreId) : undefined),
    [ctx?.genreId],
  )
  const focusText = useLiveQuery(
    async () => (ctx ? await db.focusTexts.get(ctx.focusTextId) : undefined),
    [ctx?.focusTextId],
  )

  useEffect(() => {
    if (ctx) void setLastNode(ctx.projectId, 's0.macro_notes')
  }, [ctx])

  if (!ctx) return <p className="text-sm text-gray-400">Loading…</p>

  const group = findNode('s0.macro_notes')?.node
  const areas = group?.children ?? []
  const passage = focusText?.reference?.trim() || 'your passage'
  const genreName = genre && !genre.name.startsWith('Untitled') ? genre.name : 'the genre'
  const noGenre = !genre || genre.name.startsWith('Untitled')
  const nextId = nextNavId('s0.macro_notes')
  const title = resolveGenreTokens(
    findNode('s0.macro_notes')?.node.label ?? '2c: The Big Picture — Compare & Decide',
    tokens,
  )
  const backLabel = resolveGenreTokens(
    findNode('s0.genre_choice')?.node.label ?? '2b: Choose a Genre',
    tokens,
  )
  const nextLabel = nextId ? resolveGenreTokens(findNode(nextId)?.node.label ?? '', tokens) : ''

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold" data-dfb-node="s0.macro_notes" data-dfb-field="label">
          {title}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          <span className="font-medium text-sky-700">{passage}</span> beside{' '}
          <span className="font-medium text-emerald-700">{genreName}</span>, across the four
          big-picture areas. {group?.guidance ? '' : ''}
        </p>
        {noGenre && (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            No genre is chosen yet —{' '}
            <Link to="/choose" className="font-medium underline">
              choose one in 2b first
            </Link>{' '}
            so the genre side of this page has something to show.
          </p>
        )}
      </div>

      {areas.map((area) => {
        const sourceSubId = area.xref?.find((x) => x.relation === 'derivedFrom')?.to
        return (
          <section key={area.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
              <div>
                <BlockRenderer ctx={ctx} node={area} mode={mode} />
              </div>
              {sourceSubId && (
                <div>
                  <GenreRecallPanel
                    ctx={ctx}
                    sourceSubId={sourceSubId}
                    genreName={resolveGenreTokens('{genre}', genreToken)}
                  />
                </div>
              )}
            </div>
          </section>
        )
      })}

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <Link to="/choose" className="text-sm text-gray-500 hover:underline">
          ← {backLabel}
        </Link>
        {nextId && (
          <Link
            to={routeForSub(nextId)}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Next: {nextLabel} →
          </Link>
        )}
      </div>
    </div>
  )
}
