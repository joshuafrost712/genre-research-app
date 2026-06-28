/**
 * Progress is computed against the CURRENT depth mode's visible set, not the full
 * worksheet, so Quick mode can honestly read "you have enough to start drafting."
 * Pure functions over a loaded entries array; callers supply entries via a live
 * query so the numbers update as answers change.
 */
import { effectiveLayer, findNode, journeyOrder, navTree } from './content/loader'
import { entryContainerId, ROWS_KEY } from './storage/entries'
import type { ActiveContext } from './storage/appState'
import type { Entry } from './types'
import { visibleAtDepth, type DepthMode, type GuideNode, type Layer } from '../schema/types'

export interface Count {
  done: number
  total: number
}

export interface ProgressReport {
  overall: Count
  bySubsection: Record<string, Count>
}

/** Answerable leaf blocks under a node, visible at the mode (skips group/prose). */
export function answerableLeaves(node: GuideNode, mode: DepthMode): GuideNode[] {
  const out: GuideNode[] = []
  const recurse = (n: GuideNode) => {
    for (const child of n.children ?? []) {
      if (!visibleAtDepth(child, mode)) continue
      if (child.type === 'group') recurse(child)
      else if (child.type !== 'prose') out.push(child)
    }
  }
  recurse(node)
  return out
}

function parseArray(value?: string): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface Index {
  byKey: Map<string, Entry>
  contentful: Set<string> // `${nodeId}|${containerId}` with any non-empty cell
}

function buildIndex(entries: Entry[]): Index {
  const byKey = new Map<string, Entry>()
  const contentful = new Set<string>()
  for (const e of entries) {
    const cid = e.genre_id ?? e.focus_text_id ?? e.worksheet_id ?? ''
    byKey.set(`${e.node_id}|${cid}|${e.cell_key ?? ''}`, e)
    if (e.cell_key !== ROWS_KEY && (e.text?.trim() || e.value)) {
      contentful.add(`${e.node_id}|${cid}`)
    }
  }
  return { byKey, contentful }
}

function isAnswered(node: GuideNode, layer: Layer, ctx: ActiveContext, idx: Index): boolean {
  const cid = entryContainerId(layer, ctx)
  const base = idx.byKey.get(`${node.id}|${cid}|`)
  switch (node.type) {
    case 'short_text':
    case 'long_text':
      return !!(base && (base.text?.trim() || base.is_not_applicable))
    case 'single_select':
    case 'three_point_scale':
      return !!(base && (base.value || base.is_not_applicable))
    case 'multi_select':
      return !!(base && (parseArray(base.value).length > 0 || base.is_not_applicable))
    case 'repeatable_list':
    case 'repeatable_row_table': {
      const rows = idx.byKey.get(`${node.id}|${cid}|${ROWS_KEY}`)
      return parseArray(rows?.value).length > 0
    }
    case 'fixed_grid':
      return idx.contentful.has(`${node.id}|${cid}`)
    default:
      return false
  }
}

export function computeProgress(
  entries: Entry[],
  ctx: ActiveContext,
  mode: DepthMode,
): ProgressReport {
  const idx = buildIndex(entries)
  const bySubsection: Record<string, Count> = {}
  let done = 0
  let total = 0

  for (const { subsections } of navTree()) {
    for (const sub of subsections) {
      if (!visibleAtDepth(sub, mode)) continue
      const leaves = answerableLeaves(sub, mode)
      let subDone = 0
      for (const leaf of leaves) {
        const layer = effectiveLayer(leaf.id)
        if (!layer) continue
        if (isAnswered(leaf, layer, ctx, idx)) subDone++
      }
      bySubsection[sub.id] = { done: subDone, total: leaves.length }
      done += subDone
      total += leaves.length
    }
  }

  return { overall: { done, total }, bySubsection }
}

/**
 * Progress for ONE genre's reusable research (the genre-layer subsections: 1B
 * plus Sections 2 and 3), scoped to a single genre_id rather than the active
 * context. Drives the per-genre cards + stage checklist on the genres hub. Pure
 * over a supplied entries array; genre-layer entries are keyed by genre_id, so a
 * synthetic context with that genre_id resolves the right container.
 */
export function genreProgress(
  entries: Entry[],
  projectId: string,
  genreId: string,
  mode: DepthMode,
): ProgressReport {
  const idx = buildIndex(entries)
  const ctx: ActiveContext = { projectId, focusTextId: '', genreId, worksheetId: '' }
  const bySubsection: Record<string, Count> = {}
  let done = 0
  let total = 0

  for (const { subsections } of navTree()) {
    for (const sub of subsections) {
      if (!visibleAtDepth(sub, mode)) continue
      if (effectiveLayer(sub.id) !== 'genre') continue
      const leaves = answerableLeaves(sub, mode)
      let subDone = 0
      for (const leaf of leaves) {
        const layer = effectiveLayer(leaf.id)
        if (layer !== 'genre') continue
        if (isAnswered(leaf, layer, ctx, idx)) subDone++
      }
      bySubsection[sub.id] = { done: subDone, total: leaves.length }
      done += subDone
      total += leaves.length
    }
  }

  return { overall: { done, total }, bySubsection }
}

export interface WizardStep {
  node: GuideNode
  sectionLabel: string
  subId: string
  subLabel: string
}

/**
 * Ordered answerable blocks for the guided wizard, in recommended-journey order
 * (not raw document order), so a self-guiding user does each step after the steps
 * it depends on. The Section 0 synthesis steps come last, where their inputs exist.
 */
export function wizardSequence(mode: DepthMode): WizardStep[] {
  const steps: WizardStep[] = []
  for (const subId of journeyOrder()) {
    const ref = findNode(subId)
    if (!ref) continue
    const sub = ref.node
    if (!visibleAtDepth(sub, mode)) continue
    const sectionLabel = ref.parents[0]?.label ?? ''
    for (const node of answerableLeaves(sub, mode)) {
      steps.push({ node, sectionLabel, subId: sub.id, subLabel: sub.label })
    }
  }
  return steps
}

export interface PriorityItem {
  entry: Entry
  node: GuideNode
}

/** Priority-starred rows across the worksheet, for the "Your priorities" panel. */
export function collectPriorities(
  entries: Entry[],
  ctx: ActiveContext,
  nodeOf: (id: string) => GuideNode | undefined,
): PriorityItem[] {
  return entries
    .filter((e) => e.is_priority && e.project_id === ctx.projectId)
    .map((e) => {
      const node = nodeOf(e.node_id)
      return node ? { entry: e, node } : null
    })
    .filter((x): x is PriorityItem => x !== null)
}

/**
 * Blocks/rows flagged "follow up / want more info" across the worksheet, for the
 * /follow-up hit-list. Same shape as priorities; keys on `is_concern_flag`.
 */
export function collectFollowUps(
  entries: Entry[],
  ctx: ActiveContext,
  nodeOf: (id: string) => GuideNode | undefined,
): PriorityItem[] {
  return entries
    .filter((e) => e.is_concern_flag && e.project_id === ctx.projectId)
    .map((e) => {
      const node = nodeOf(e.node_id)
      return node ? { entry: e, node } : null
    })
    .filter((x): x is PriorityItem => x !== null)
}
