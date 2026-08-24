/**
 * Bring the work from one project into another — the "I already did days of work
 * in my own worksheet, and now my team exists" path from the Psalms workshop.
 *
 * Containers are matched by what people can see, never by id: genres by
 * normalized name, passages by their parsed reference (falling back to the
 * normalized text), worksheets by the (passage, genre) pair they join. Ids are
 * per-project, so id-matching would match nothing; name-matching is what makes
 * "my Lullaby" and "the team's Lullaby" the same genre.
 *
 * Containers CREATED here get DETERMINISTIC ids derived from the target project
 * and the normalized name — the same convergence trick as the ws-<ft>-<genre>
 * worksheet id, and for the same reason (stage-6 review finding, 2026-08-24):
 * two members importing "Lament" in the same sync window would otherwise each
 * mint a uid, and the team's answers split across two mutually invisible
 * genres that no later name-match can reunite.
 *
 * Placeholder names never match. Half the workshop holds real work under
 * "Untitled genre", and merging two strangers' untitled containers because
 * neither got around to naming them would interleave unrelated answers. A
 * placeholder-named container imports as its own container, labelled with where
 * it came from.
 *
 * Conflict rule, Joshua's call (2026-08-24): when both sides answered the same
 * question, APPEND the imported answer below the team's with a source marker.
 * Nothing is overwritten and nothing is parked out of sight. Select/scale
 * answers cannot be appended, so there the team's value stands and the import
 * only fills empties. Cached translations of an appended cell are extended, not
 * dropped — they were paid for on a metered key.
 *
 * Everything is written through the existing single write paths (upsertEntry,
 * trackUpsert) so LWW stamps and the outbox behave exactly as a hand-typed edit
 * would. The source project is never modified. Recordings live outside the sync
 * tables and do NOT transfer — the UI says so rather than letting silence imply
 * they moved.
 */
import { db } from '../storage/db'
import { uid, now } from '../util'
import { trackUpsert } from '../sync/outbox'
import type { ActiveContext } from '../storage/appState'
import { upsertEntry, findEntry, ROWS_KEY } from '../storage/entries'
import { findNode } from '../content/loader'
import type { Layer } from '../../schema/types'
import type { Entry, FocusText, Genre, TranslationWorksheet } from '../types'

export interface ImportCounts {
  genres: number // created in the target
  passages: number // created in the target
  answers: number // entries copied, filled, or appended
  appended: number // cells where both sides had text
  skipped: number // entries whose worksheet node no longer exists in the content
}

export interface ImportSource {
  projectId: string
  name: string
  passages: string[]
  genres: string[]
  answerCount: number
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** "Untitled genre" / "Untitled focus text" and friends carry no identity. */
const isPlaceholder = (normalized: string) => normalized === '' || normalized.startsWith('untitled')

/**
 * Small stable hash for deterministic container ids. Not cryptographic and does
 * not need to be: it only has to make two devices computing an id for the same
 * (target project, name) agree, and the input already contains the target's
 * uuid, so cross-project collisions would need a hash collision AND a shared
 * name. FNV-1a run twice with different seeds for 64 bits of spread.
 */
function stableHash(input: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return fnv(0x811c9dc5) + fnv(0x9747b28c)
}

/** Passages match on the parsed reference when both sides parse, else on text. */
function ftKey(ft: FocusText): string {
  if (ft.book && ft.chapter != null) {
    return `${ft.book}|${ft.chapter}|${ft.verse_start ?? ''}|${ft.verse_end ?? ''}`
  }
  return norm(ft.reference)
}

/** An entry that carries something a person typed or chose. */
function hasContent(e: Entry): boolean {
  return Boolean(e.text?.trim() || e.value?.trim() || e.is_concern_flag || e.is_not_applicable)
}

/** The other projects on this device that have work worth bringing in. */
export async function listImportSources(targetId: string): Promise<ImportSource[]> {
  const projects = (await db.projects.toArray()).filter((p) => p.id !== targetId)
  const out: ImportSource[] = []
  for (const p of projects) {
    const entries = await db.entries.where('project_id').equals(p.id).toArray()
    const answerCount = entries.filter((e) => e.cell_key !== ROWS_KEY && hasContent(e)).length
    if (answerCount === 0) continue
    const fts = await db.focusTexts.where('project_id').equals(p.id).toArray()
    const genres = await db.genres.where('project_id').equals(p.id).toArray()
    out.push({
      projectId: p.id,
      name: p.name,
      passages: fts.map((f) => f.reference),
      genres: genres.map((g) => g.name),
      answerCount,
    })
  }
  return out.sort((a, b) => b.answerCount - a.answerCount)
}

/**
 * Merge everything from `sourceId` into `targetId`.
 *
 * `dryRun` computes the exact counts without writing a byte — the preview the
 * confirm dialog shows, produced by the same code path that will do the work,
 * so the preview can never drift from the deed.
 *
 * Idempotence: containers converge on deterministic ids; a cell append is
 * skipped when the target already carries this import's marker-stamped block
 * (or the identical text), so a nervous second tap does not double-paste.
 */
export async function importProjectInto(
  sourceId: string,
  targetId: string,
  opts?: { dryRun?: boolean },
): Promise<ImportCounts> {
  const dry = opts?.dryRun ?? false
  if (sourceId === targetId) throw new Error('That is the team you are already in.')
  const source = await db.projects.get(sourceId)
  const target = await db.projects.get(targetId)
  if (!source || !target) throw new Error('Could not find both projects on this device.')

  const srcLabel = source.name?.trim() || 'my earlier worksheet'
  const marker = `[From ${srcLabel}]`
  const counts: ImportCounts = { genres: 0, passages: 0, answers: 0, appended: 0, skipped: 0 }

  // --- containers: match by name/reference, create what is missing ------------
  const srcGenres = await db.genres.where('project_id').equals(sourceId).toArray()
  const tgtGenres = await db.genres.where('project_id').equals(targetId).toArray()
  const genreMap = new Map<string, string>() // source genre id -> target genre id
  for (const sg of srcGenres) {
    const key = norm(sg.name)
    const placeholder = isPlaceholder(key)
    const match = placeholder ? undefined : tgtGenres.find((tg) => norm(tg.name) === key)
    if (match) {
      genreMap.set(sg.id, match.id)
      continue
    }
    // A placeholder-named container gets a label that says where it came from,
    // and its id is salted with the source project so two members' unrelated
    // "Untitled genre"s stay separate.
    const name = placeholder ? `${sg.name.trim() || 'Untitled genre'} (${srcLabel})` : sg.name
    const id = `g-${stableHash(`${targetId}|genre|${placeholder ? sourceId + '|' : ''}${norm(name)}`)}`
    genreMap.set(sg.id, id)
    const already = await db.genres.get(id)
    if (already) continue // another member (or an earlier run) beat us to it
    counts.genres++
    if (dry) continue
    const created: Genre = {
      id,
      project_id: targetId,
      name,
      name_meaning: sg.name_meaning,
      vitality_rating: sg.vitality_rating,
      is_sensitive: sg.is_sensitive,
      created_at: now(),
      updated_at: now(),
    }
    // Written directly rather than via createGenre(), which would also move the
    // person's active-genre cursor — an import must not hijack where they stand.
    await db.genres.put(created)
    await trackUpsert('genres', created)
    tgtGenres.push(created)
  }

  const srcFts = await db.focusTexts.where('project_id').equals(sourceId).toArray()
  const tgtFts = await db.focusTexts.where('project_id').equals(targetId).toArray()
  const ftMap = new Map<string, string>()
  for (const sf of srcFts) {
    const key = ftKey(sf)
    const placeholder = isPlaceholder(norm(sf.reference))
    const match = placeholder ? undefined : tgtFts.find((tf) => ftKey(tf) === key)
    if (match) {
      ftMap.set(sf.id, match.id)
      continue
    }
    const reference = placeholder
      ? `${sf.reference.trim() || 'Untitled focus text'} (${srcLabel})`
      : sf.reference
    const id = `ft-${stableHash(`${targetId}|ft|${placeholder ? sourceId + '|' : ''}${norm(reference)}`)}`
    ftMap.set(sf.id, id)
    const already = await db.focusTexts.get(id)
    if (already) continue
    counts.passages++
    if (dry) continue
    const created: FocusText = {
      ...sf,
      id,
      project_id: targetId,
      reference,
      created_at: now(),
      updated_at: now(),
    }
    await db.focusTexts.put(created)
    await trackUpsert('focusTexts', created)
    tgtFts.push(created)
  }

  // Worksheets: the deterministic ws-<ft>-<genre> id in the TARGET's id space.
  // Resolved by (pair) lookup first so legacy random-id worksheets keep working,
  // exactly like ensureWorksheetFor — not called directly because a dry run must
  // not write.
  const srcWs = await db.worksheets.where('project_id').equals(sourceId).toArray()
  const tgtWsAll = await db.worksheets.where('project_id').equals(targetId).toArray()
  const wsMap = new Map<string, string>()
  for (const sw of srcWs) {
    const ft = ftMap.get(sw.focus_text_id)
    const g = genreMap.get(sw.genre_id)
    if (!ft || !g) continue // orphaned worksheet in the source; nothing to attach to
    const existing = tgtWsAll.find((w) => w.focus_text_id === ft && w.genre_id === g)
    const twId = existing?.id ?? `ws-${ft}-${g}`
    wsMap.set(sw.id, twId)

    const srcDraft = sw.final_translation_draft?.trim() ?? ''
    const tgtDraft = existing?.final_translation_draft?.trim() ?? ''
    const draftStamp = `${marker} ${srcDraft}`
    const needsDraft = srcDraft && srcDraft !== tgtDraft && !tgtDraft.includes(draftStamp)
    if (needsDraft && tgtDraft) counts.appended++
    if (dry) continue

    const base: TranslationWorksheet = existing ?? {
      id: twId,
      project_id: targetId,
      focus_text_id: ft,
      genre_id: g,
      status: 'draft',
      created_at: now(),
      updated_at: now(),
    }
    if (!existing || needsDraft) {
      const merged = needsDraft
        ? tgtDraft
          ? `${tgtDraft}\n\n${draftStamp}`
          : srcDraft
        : base.final_translation_draft
      const row = { ...base, final_translation_draft: merged, updated_at: now() }
      await db.worksheets.put(row)
      await trackUpsert('worksheets', row)
      if (!existing) tgtWsAll.push(row)
    }
  }

  // --- captured notes: clone on first reference so provenance survives --------
  const noteMap = new Map<string, string>()
  const cloneNote = async (srcNoteId: string | undefined): Promise<string | undefined> => {
    if (!srcNoteId || dry) return undefined
    const alreadyCloned = noteMap.get(srcNoteId)
    if (alreadyCloned) return alreadyCloned
    const note = await db.capturedNotes.get(srcNoteId)
    if (!note) return undefined
    const cloned = { ...note, id: uid(), project_id: targetId }
    await db.capturedNotes.put(cloned)
    await trackUpsert('capturedNotes', cloned)
    noteMap.set(srcNoteId, cloned.id)
    return cloned.id
  }

  // --- entries -----------------------------------------------------------------
  const resolveTarget = (e: Entry): { layer: Layer; ctx: ActiveContext } | null => {
    const base: ActiveContext = { projectId: targetId, focusTextId: '', genreId: '', worksheetId: '' }
    if (e.genre_id) {
      const id = genreMap.get(e.genre_id)
      return id ? { layer: 'genre', ctx: { ...base, genreId: id } } : null
    }
    if (e.focus_text_id) {
      const id = ftMap.get(e.focus_text_id)
      return id ? { layer: 'focusText', ctx: { ...base, focusTextId: id } } : null
    }
    if (e.worksheet_id) {
      const id = wsMap.get(e.worksheet_id)
      return id ? { layer: 'synthesis', ctx: { ...base, worksheetId: id } } : null
    }
    return null
  }

  const srcEntries = await db.entries.where('project_id').equals(sourceId).toArray()

  // Row-order sidecars first: a row's cells are invisible until its id is in the
  // sidecar (the exact orphan-cells failure merge.ts guards against), so the
  // UNION of the two orders must land regardless of entry iteration order. Row
  // ids are uids and never collide across projects, so union means "the team's
  // rows first, then the imported ones".
  for (const e of srcEntries) {
    if (e.cell_key !== ROWS_KEY) continue
    const t = resolveTarget(e)
    if (!t || !findNode(e.node_id)) continue
    const srcIds = parseIds(e.value)
    if (srcIds.length === 0) continue
    if (dry) continue
    const existing = await findEntry(t.ctx, e.node_id, t.layer, ROWS_KEY)
    const tgtIds = parseIds(existing?.value)
    const union = [...tgtIds, ...srcIds.filter((id) => !tgtIds.includes(id))]
    if (union.length !== tgtIds.length) {
      await upsertEntry(t.ctx, e.node_id, t.layer, { value: JSON.stringify(union) }, ROWS_KEY)
    }
  }

  for (const e of srcEntries) {
    if (e.cell_key === ROWS_KEY || !hasContent(e)) continue
    if (!findNode(e.node_id)) {
      // A row from an older content version would import as an answer nothing
      // renders — the same invisible-answer failure as a missing row id.
      counts.skipped++
      continue
    }
    const t = resolveTarget(e)
    if (!t) continue
    const existing = await findEntry(t.ctx, e.node_id, t.layer, e.cell_key)

    if (!existing) {
      counts.answers++
      if (dry) continue
      await upsertEntry(
        t.ctx,
        e.node_id,
        t.layer,
        {
          text: e.text,
          value: e.value,
          source_language: e.source_language,
          is_not_applicable: e.is_not_applicable,
          is_asked: e.is_asked,
          is_concern_flag: e.is_concern_flag,
          routing_status: e.routing_status,
          captured_note_id: await cloneNote(e.captured_note_id),
          // AI proposals pending review are deliberately NOT carried over: they
          // are suggestions about the source's cell, not work the person did.
        },
        e.cell_key,
      )
      continue
    }

    const srcText = e.text?.trim() ?? ''
    const tgtText = existing.text?.trim() ?? ''
    const stamp = `${marker} ${srcText}`
    const patch: Parameters<typeof upsertEntry>[3] = {}
    let changed = false

    if (srcText && !tgtText) {
      patch.text = e.text
      patch.source_language = existing.source_language ?? e.source_language
      changed = true
      counts.answers++
    } else if (
      srcText &&
      tgtText &&
      srcText !== tgtText &&
      !existing.text.includes(stamp) &&
      // A long identical passage already inside the team's answer is the same
      // answer, not a new one. Short texts ("yes") are too easy to contain by
      // accident, so they append rather than risk silently dropping real work.
      !(srcText.length >= 24 && existing.text.includes(srcText))
    ) {
      patch.text = `${existing.text.trimEnd()}\n\n${stamp}`
      // Extend cached translations instead of letting the text change drop them:
      // they were paid for on a metered key, and a patch that carries
      // `translations` is exempt from upsertEntry's invalidation.
      if (existing.translations && Object.keys(existing.translations).length > 0) {
        const merged: Record<string, string> = {}
        for (const [locale, tr] of Object.entries(existing.translations)) {
          const srcTr = e.translations?.[locale]
          merged[locale] = `${tr.trimEnd()}\n\n${marker} ${(srcTr ?? srcText).trim()}`
        }
        patch.translations = merged
      }
      changed = true
      counts.answers++
      counts.appended++
    }

    if (e.value?.trim() && !existing.value?.trim()) {
      patch.value = e.value
      changed = true
      if (!patch.text) counts.answers++
    }
    if (e.is_concern_flag && !existing.is_concern_flag) {
      patch.is_concern_flag = true
      changed = true
    }
    if (patch.text !== undefined && !existing.captured_note_id) {
      patch.captured_note_id = await cloneNote(e.captured_note_id)
    }

    if (changed && !dry) await upsertEntry(t.ctx, e.node_id, t.layer, patch, e.cell_key)
  }

  return counts
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
