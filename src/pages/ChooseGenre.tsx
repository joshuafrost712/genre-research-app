import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { cellKey, db } from '../lib/storage/db'
import { useActiveContext } from '../components/ActiveContextProvider'
import { useDepthMode } from '../components/DepthModeContext'
import { BlockRenderer } from '../components/blocks/BlockRenderer'
import { resolveGenreTokens, useNameTokens } from '../components/GenreNameProvider'
import { findNode, nextNavId, routeForSub, splitStageTitle } from '../lib/content/loader'
import {
  ensureWorksheetFor,
  setActiveGenre,
  setLastNode,
  type ActiveContext,
} from '../lib/storage/appState'
import { addRow, upsertEntry, useAllEntries, useEntry } from '../lib/storage/entries'
import { fullAnswerBehindCell, shortPrompt, summaryCell } from '../lib/content/summarize'
import { mergeOptions, useCustomOptions } from '../lib/customOptions'
import {
  deriveShortlist,
  keepGenre,
  setAsideGenre,
  setRestAside,
  KEEP_CAP,
  type ShortlistIds,
} from '../lib/chooseShortlist'
import type { Entry, Genre } from '../lib/types'
import type { SelectOption } from '../schema/types'

/**
 * 2b: Choose a genre — the staged funnel. (1) Say what the passage is doing.
 * (2) Compare purposes first and shortlist the top 3 (others are set aside,
 * recoverable). (3) Weigh the social factors across the shortlist with
 * green / yellow / red fit flags — judgments about THIS passage, not facts
 * about the genre. (4) Choose. Choosing locks the genre in until changed; if
 * anything yellow or red is flagged, a guard dialog lists it and asks the team
 * to confirm with "We have a plan to handle these" — honesty support, never
 * control.
 */

/** The social/anthropological factors combed in step 3 (genre-layer prompts). */
const FACTORS = [
  's1b.purposes',
  's2eth.who',
  's2eth.when',
  's2eth.materials',
  's2eth.space',
  's1b.associations',
  's1b.vitality',
  's2eth.stable_malleable',
]

type FlagLevel = '' | 'good' | 'question' | 'warning'

const FLAG_STYLE: Record<Exclude<FlagLevel, ''>, string> = {
  good: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  question: 'bg-amber-100 text-amber-800 border-amber-300',
  warning: 'bg-red-100 text-red-800 border-red-300',
}

const FLAG_ICON: Record<Exclude<FlagLevel, ''>, string> = {
  good: '● good fit',
  question: '? question',
  warning: '⚠ warning',
}

export function ChooseGenre() {
  const { ctx, reload } = useActiveContext()
  const { mode } = useDepthMode()
  const tokens = useNameTokens()
  const entries = useAllEntries(ctx)
  const genres = useLiveQuery(
    () => (ctx ? db.genres.where('project_id').equals(ctx.projectId).sortBy('created_at') : []),
    [ctx?.projectId],
  )
  const focusText = useLiveQuery(
    async () => (ctx ? await db.focusTexts.get(ctx.focusTextId) : undefined),
    [ctx?.focusTextId],
  )
  const lockedEntry = useEntry(ctx, 'choose.locked', 'focusText')
  const shortlistEntry = useEntry(ctx, 'choose.shortlist', 'focusText')
  const setAsideEntry = useEntry(ctx, 'choose.setAside', 'focusText')
  const customPurposes = useCustomOptions(ctx?.projectId ?? '', 's1b.purpose_families')
  const [showSetAside, setShowSetAside] = useState(false)
  const [guardFor, setGuardFor] = useState<Genre | null>(null)
  const seedingRef = useRef(false)

  // Per-genre synthesis contexts (flags live on the passage x genre worksheet).
  const [genreCtxs, setGenreCtxs] = useState<Record<string, ActiveContext>>({})
  const projectId = ctx?.projectId
  const focusTextId = ctx?.focusTextId
  const genreIdsKey = (genres ?? []).map((g) => g.id).join(',')
  useEffect(() => {
    if (!projectId || !focusTextId || !genreIdsKey) return
    let cancelled = false
    void (async () => {
      const map: Record<string, ActiveContext> = {}
      for (const genreId of genreIdsKey.split(',')) {
        const ws = await ensureWorksheetFor(projectId, focusTextId, genreId)
        map[genreId] = { projectId, focusTextId, genreId, worksheetId: ws.id }
      }
      if (!cancelled) setGenreCtxs(map)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, focusTextId, genreIdsKey])

  useEffect(() => {
    if (ctx) void setLastNode(ctx.projectId, 's0.genre_choice')
  }, [ctx])

  // #25: every kept genre gets a pre-named row in the candidates table, once
  // per genre per passage (the seeded marker means a deleted row stays
  // deleted). The ref is the single-flight guard against StrictMode's
  // double-run of effects — the bug class behind the spec-09 duplicate genres.
  const keptValue = shortlistEntry?.value
  useEffect(() => {
    if (!ctx || !genres || entries === undefined || seedingRef.current) return
    const keptIds = parseIds(keptValue)
    if (keptIds.length === 0) return
    const seeded = parseIds(
      entries.find(
        (e) =>
          e.node_id === 'choose.seededCandidates' &&
          e.focus_text_id === ctx.focusTextId &&
          !e.cell_key,
      )?.value,
    )
    const existingNames = new Set(
      entries
        .filter(
          (e) =>
            e.node_id === 's0.genre_choice.candidates' &&
            e.worksheet_id === ctx.worksheetId &&
            e.cell_key?.endsWith('__name'),
        )
        .map((e) => (e.text ?? '').trim().toLowerCase()),
    )
    const toSeed = keptIds
      .map((id) => genres.find((g) => g.id === id))
      .filter((g): g is Genre => !!g)
      .filter((g) => !seeded.includes(g.id) && !existingNames.has(g.name.trim().toLowerCase()))
    if (toSeed.length === 0) return
    seedingRef.current = true
    void (async () => {
      try {
        for (const g of toSeed) {
          const rowId = await addRow(ctx, 's0.genre_choice.candidates', 'synthesis')
          await upsertEntry(
            ctx,
            's0.genre_choice.candidates',
            'synthesis',
            { text: g.name },
            cellKey(rowId, 'name'),
          )
        }
        await upsertEntry(ctx, 'choose.seededCandidates', 'focusText', {
          value: JSON.stringify([...seeded, ...toSeed.map((g) => g.id)]),
        })
      } finally {
        seedingRef.current = false
      }
    })()
  }, [ctx, genres, entries, keptValue])

  if (!ctx || entries === undefined || genres === undefined) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  const passage = focusText?.reference?.trim() || 'this passage'
  const purposeNode = findNode('s0.purpose')?.node
  const intendedUseNode = findNode('s0.purpose.intended_use')?.node
  const candidatesNode = findNode('s0.genre_choice.candidates')?.node

  if (genres.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Header passage={passage} />
        <p className="text-sm text-gray-600">
          You have no genres described yet. Genre choice needs Workspace 1's data first.
        </p>
        <Link
          to="/worksheet/s1a"
          className="self-start rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Go to Workspace 1: Find Local Genres →
        </Link>
      </div>
    )
  }

  const ids: ShortlistIds = {
    keptIds: parseIds(shortlistEntry?.value),
    setAsideIds: parseIds(setAsideEntry?.value),
  }
  const { kept, setAside, undecided, atCap } = deriveShortlist(genres, ids.keptIds, ids.setAsideIds)
  const lockedGenre = lockedEntry?.value ? genres.find((g) => g.id === lockedEntry.value) : undefined

  const passageBroad = entries.find(
    (e) => e.node_id === 's0.purpose.broad_genre' && e.focus_text_id === ctx.focusTextId && !e.cell_key,
  )?.value

  const writeShortlist = (next: ShortlistIds) => {
    void upsertEntry(ctx, 'choose.shortlist', 'focusText', {
      value: JSON.stringify(next.keptIds),
    })
    void upsertEntry(ctx, 'choose.setAside', 'focusText', {
      value: JSON.stringify(next.setAsideIds),
    })
  }

  const flagsFor = (g: Genre): Array<{ factorId: string; level: FlagLevel; note: string }> => {
    const gctx = genreCtxs[g.id]
    if (!gctx) return []
    return FACTORS.map((factorId) => {
      const level = (entries.find(
        (e) =>
          e.node_id === 'choose.flag' &&
          e.worksheet_id === gctx.worksheetId &&
          e.cell_key === factorId,
      )?.value ?? '') as FlagLevel
      return { factorId, level, note: summaryCell(entries, g.id, factorId).text }
    }).filter((f) => f.level === 'question' || f.level === 'warning')
  }

  const lockIn = async (g: Genre) => {
    setGuardFor(null)
    await upsertEntry(ctx, 'choose.locked', 'focusText', { value: g.id, text: g.name })
    await setActiveGenre(ctx.projectId, g.id)
    const ws = await ensureWorksheetFor(ctx.projectId, ctx.focusTextId, g.id)
    await upsertEntry(
      { ...ctx, genreId: g.id, worksheetId: ws.id },
      's0.genre_choice.chosen',
      'synthesis',
      { text: g.name },
    )
    reload()
  }

  const requestLock = (g: Genre) => {
    if (flagsFor(g).length > 0) setGuardFor(g)
    else void lockIn(g)
  }

  const nextId = nextNavId('s0.genre_choice')
  const nextLabel = nextId ? resolveGenreTokens(findNode(nextId)?.node.label ?? '', tokens) : ''
  const nextChip = nextLabel ? splitStageTitle(nextLabel)[0] : ''

  return (
    <div className="flex flex-col gap-6">
      <Header passage={passage} />

      {lockedGenre && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
              Locked in for {passage}
            </div>
            <div className="text-lg font-semibold text-emerald-900">{lockedGenre.name}</div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void upsertEntry(ctx, 'choose.locked', 'focusText', { value: '', text: '' })}
              className="text-xs text-gray-500 hover:underline"
            >
              Choose a different genre
            </button>
            {nextId && (
              <Link
                to={routeForSub(nextId)}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Continue to {nextChip} →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Step 1: the passage's purpose */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <StepHeading n={1} title="Say what the passage is doing" />
        {purposeNode && <BlockRenderer ctx={ctx} node={purposeNode} mode={mode} />}
      </section>

      {/* Step 2: compare purposes, shortlist top 3 */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <StepHeading
          n={2}
          title="Compare purposes and keep your top 3"
          hint="Purpose is the matching key: keep the genres whose purposes fit what this passage is doing. Set the others aside — you can always bring them back."
        />
        <ul className="flex flex-col gap-2">
          {[...kept, ...undecided].map((g) => (
            <PurposeRow
              key={g.id}
              genre={g}
              entries={entries}
              customPurposes={customPurposes}
              passageBroad={passageBroad}
              state={kept.some((k) => k.id === g.id) ? 'kept' : 'undecided'}
              atCap={atCap}
              onKeep={() => writeShortlist(keepGenre(ids, g.id))}
              onSetAside={() => writeShortlist(setAsideGenre(ids, g.id))}
            />
          ))}
        </ul>
        {atCap && undecided.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            You already have {KEEP_CAP} — set one aside to keep a different genre.
          </p>
        )}
        {kept.length > 0 && undecided.length > 0 && (
          <button
            type="button"
            onClick={() => writeShortlist(setRestAside(ids, genres.map((g) => g.id)))}
            className="mt-2 text-xs text-gray-500 hover:underline"
          >
            Set the {undecided.length === 1 ? 'other genre' : `other ${undecided.length} genres`} aside
          </button>
        )}
        {setAside.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowSetAside((v) => !v)}
              className="text-xs text-gray-500 hover:underline"
            >
              {showSetAside ? 'Hide' : 'Show'} {setAside.length} set-aside{' '}
              {setAside.length === 1 ? 'genre' : 'genres'}
            </button>
            {showSetAside && (
              <ul className="mt-2 flex flex-col gap-2">
                {setAside.map((g) => (
                  <PurposeRow
                    key={g.id}
                    genre={g}
                    entries={entries}
                    customPurposes={customPurposes}
                    passageBroad={passageBroad}
                    state="aside"
                    atCap={atCap}
                    dim
                    onKeep={() => writeShortlist(keepGenre(ids, g.id))}
                    onSetAside={() => undefined}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Step 3: how the translation will be used (moved here from 2a, feedback #12) */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <StepHeading
          n={3}
          title="Say how people will use it"
          hint="Knowing how and where people will use this translation helps you weigh the social factors and choose the best genre."
        />
        {intendedUseNode && <BlockRenderer ctx={ctx} node={intendedUseNode} mode={mode} />}
      </section>

      {/* Step 4: the social comb with fit flags */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <StepHeading
          n={4}
          title="Weigh the social factors"
          hint="Tap a flag to mark how each factor fits THIS passage: green = good fit (1 tap), yellow = a question to settle (2 taps), red = a warning (3 taps); a 4th tap clears it. The colors are for seeing at a glance — they never decide for you. See the Note Taking Space below for a place to record more of your thoughts on these factors."
        />
        {kept.length === 0 ? (
          <p className="text-sm text-gray-500">Keep at least one genre in step 2 first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-xs font-semibold text-gray-500">
                    Factor
                  </th>
                  {kept.map((g) => (
                    <th key={g.id} className="min-w-44 max-w-60 px-2 py-2 font-semibold text-gray-800">
                      {g.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FACTORS.map((factorId) => {
                  const node = findNode(factorId)?.node
                  return (
                    <tr key={factorId} className="border-b border-gray-100 align-top last:border-0">
                      <th className="sticky left-0 z-10 max-w-36 bg-white px-2 py-2 text-left text-xs font-medium text-gray-500">
                        {node ? shortPrompt(node) : factorId}
                      </th>
                      {kept.map((g) => (
                        <td key={g.id} className="max-w-60 px-2 py-2">
                          <FlagCell
                            gctx={genreCtxs[g.id]}
                            factorId={factorId}
                            genreName={g.name}
                            note={summaryCell(entries, g.id, factorId).text}
                            fullText={fullAnswerBehindCell(entries, g.id, factorId)}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Step 5: choose */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <StepHeading
          n={5}
          title="Choose the genre for this passage"
          hint="Your choice stays locked in until you change it. Anything you flagged yellow or red will be shown once more before you commit."
        />
        {kept.length === 0 ? (
          <p className="text-sm text-gray-500">Keep at least one genre in step 2 first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {kept.map((g) => {
              const concerns = flagsFor(g)
              const isLocked = lockedGenre?.id === g.id
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => requestLock(g)}
                  disabled={isLocked}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    isLocked
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-800 text-white hover:bg-gray-700'
                  }`}
                >
                  {isLocked ? `✓ ${g.name} (locked in)` : `Choose ${g.name}`}
                  {!isLocked && concerns.length > 0 && (
                    <span className="ml-1.5 text-xs text-red-300">
                      {concerns.length} flag{concerns.length === 1 ? '' : 's'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Optional notes: the candidates table (rows are seeded from kept genres) */}
      <details className="rounded-xl border border-gray-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          Note Taking Space for Considering Genres
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {candidatesNode && <BlockRenderer ctx={ctx} node={candidatesNode} mode={mode} />}
        </div>
      </details>

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <Link to="/" className="text-sm text-gray-500 hover:underline">
          Home
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

      {guardFor && (
        <GuardDialog
          genre={guardFor}
          concerns={flagsFor(guardFor)}
          onCancel={() => setGuardFor(null)}
          onConfirm={() => void lockIn(guardFor)}
        />
      )}
    </div>
  )
}

function Header({ passage }: { passage: string }) {
  const tokens = useNameTokens()
  const title = findNode('s0.genre_choice')?.node.label ?? '2b: Choose a Genre'
  const findLabel = findNode('s1a')?.node.label ?? '1a: Find Local Genres'
  return (
    <div>
      <h1 className="text-2xl font-semibold" data-dfb-node="s0.genre_choice" data-dfb-field="label">
        {resolveGenreTokens(title, tokens)}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        For <span className="font-medium text-sky-700">{passage}</span>: compare purposes first,
        keep the top 3, weigh the social factors, then choose.
      </p>
      <p className="mt-2 rounded-md bg-sky-50 p-3 text-sm text-sky-900">
        This step draws on the local genres you found and described in Workspace 1. The more
        complete your answers in 1b and 1c are, the better this comparison works.{' '}
        <Link to="/worksheet/s1a" className="font-medium underline">
          Go to {resolveGenreTokens(findLabel, tokens)}
        </Link>
      </p>
    </div>
  )
}

function StepHeading({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">
          {n}
        </span>
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

/** One genre in the purpose-comparison list: families, purposes, keep/set-aside. */
function PurposeRow({
  genre,
  entries,
  customPurposes,
  passageBroad,
  state,
  atCap,
  dim,
  onKeep,
  onSetAside,
}: {
  genre: Genre
  entries: Entry[]
  customPurposes: SelectOption[]
  passageBroad?: string
  /** kept = on the shortlist; aside = explicitly set aside; undecided = neither. */
  state: 'kept' | 'undecided' | 'aside'
  atCap: boolean
  dim?: boolean
  onKeep: () => void
  onSetAside: () => void
}) {
  const kept = state === 'kept'
  const familiesNode = findNode('s1b.purpose_families')?.node
  const purposeOptions = familiesNode ? mergeOptions(familiesNode, customPurposes) : customPurposes
  const familyIds = parseIds(
    entries.find(
      (e) => e.node_id === 's1b.purpose_families' && e.genre_id === genre.id && !e.cell_key,
    )?.value,
  )
  const purposes = summaryCell(entries, genre.id, 's1b.purposes').text

  return (
    <li
      className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 ${
        kept ? 'border-sky-300 bg-sky-50/50' : 'border-gray-200 bg-white'
      } ${dim ? 'opacity-70' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-900">{genre.name}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {familyIds.length === 0 ? (
            <span className="text-xs text-gray-400">
              No purposes recorded yet —{' '}
              <Link to="/worksheet/s1b" className="text-sky-700 hover:underline">
                add them in 1b
              </Link>
            </span>
          ) : (
            familyIds.map((id) => {
              const label =
                purposeOptions.find((o) => o.id === id)?.label ?? (id === 'other' ? 'Other' : id)
              const match = passageBroad != null && id === passageBroad
              return (
                <span
                  key={id}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    match
                      ? 'bg-sky-600 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                  title={match ? 'Matches what this passage is doing' : undefined}
                >
                  {match ? '★ ' : ''}
                  {label}
                </span>
              )
            })
          )}
        </div>
        {purposes && <p className="mt-1 text-xs text-gray-500">{purposes}</p>}
      </div>
      {kept ? (
        <button type="button" onClick={onSetAside} className="text-xs text-gray-500 hover:underline">
          Set aside
        </button>
      ) : (
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={onKeep}
            disabled={atCap}
            title={atCap ? `You already have ${KEEP_CAP} — set one aside first.` : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              atCap
                ? 'cursor-not-allowed bg-gray-200 text-gray-400'
                : 'bg-gray-800 text-white hover:bg-gray-700'
            }`}
          >
            {/* "Bring back" only for a genre someone chose to set aside (#21). */}
            {state === 'aside' ? 'Bring back' : 'Keep'}
          </button>
          {state === 'undecided' && (
            <button
              type="button"
              onClick={onSetAside}
              className="text-xs text-gray-500 hover:underline"
            >
              Set aside
            </button>
          )}
        </span>
      )}
    </li>
  )
}

/** One cell of the social comb: the genre's note + a cycling fit flag. */
function FlagCell({
  gctx,
  factorId,
  genreName,
  note,
  fullText,
}: {
  gctx?: ActiveContext
  factorId: string
  genreName: string
  note: string
  fullText: string
}) {
  const entry = useEntry(gctx ?? null, 'choose.flag', 'synthesis', factorId)
  const [showFull, setShowFull] = useState(false)
  const level = (entry?.value ?? '') as FlagLevel
  const cycle: FlagLevel[] = ['', 'good', 'question', 'warning']
  const next = cycle[(cycle.indexOf(level) + 1) % cycle.length]
  const sourceSub = findNode(factorId)?.parents.at(-1)?.id
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={!gctx}
        onClick={() =>
          gctx && void upsertEntry(gctx, 'choose.flag', 'synthesis', { value: next }, factorId)
        }
        className={`self-start rounded-md border px-2 py-0.5 text-[11px] font-medium ${
          level ? FLAG_STYLE[level] : 'border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100'
        }`}
        title="Tap to cycle: good fit (1 tap) → question (2 taps) → warning (3 taps) → clear"
      >
        {level ? FLAG_ICON[level] : '○ flag'}
      </button>
      <div className="whitespace-pre-wrap text-xs text-gray-600">
        {note || <span className="text-gray-300">nothing recorded</span>}
      </div>
      {fullText && (
        <button
          type="button"
          onClick={() => setShowFull(true)}
          className="self-start text-[11px] text-sky-700 hover:underline"
        >
          Read the full note
        </button>
      )}
      {showFull && (
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowFull(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {genreName}
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-gray-900">
              {(() => {
                const node = findNode(factorId)?.node
                return node ? shortPrompt(node) : factorId
              })()}
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{fullText}</p>
            <div className="mt-4 flex items-center justify-between">
              {sourceSub && (
                <Link
                  to={`/worksheet/${sourceSub}`}
                  className="text-xs text-sky-700 hover:underline"
                >
                  Edit in Workspace 1 →
                </Link>
              )}
              <button
                type="button"
                onClick={() => setShowFull(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The lock-in guard: everything concerning, seen once, at the decision moment. */
function GuardDialog({
  genre,
  concerns,
  onCancel,
  onConfirm,
}: {
  genre: Genre
  concerns: Array<{ factorId: string; level: FlagLevel; note: string }>
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-gray-900">
          Before you lock in {genre.name}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          You flagged {concerns.length} {concerns.length === 1 ? 'thing' : 'things'} while
          comparing. Take one more look — being honest with yourselves now saves grief later.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {concerns.map((c) => {
            const node = findNode(c.factorId)?.node
            return (
              <li key={c.factorId} className="rounded-lg border border-gray-200 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                      c.level ? FLAG_STYLE[c.level as Exclude<FlagLevel, ''>] : ''
                    }`}
                  >
                    {c.level === 'warning' ? '⚠ warning' : '? question'}
                  </span>
                  <span className="text-xs font-medium text-gray-600">
                    {node ? shortPrompt(node) : c.factorId}
                  </span>
                </div>
                {c.note && <p className="mt-1 text-xs text-gray-500">{c.note}</p>}
              </li>
            )
          })}
        </ul>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            We have a plan to handle these
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  )
}

function parseIds(value?: string): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}
