/**
 * Content loader. For the MVP the worksheet config is bundled JSON; later it is
 * generated from Katie's authoring Google Sheet and fetched as a versioned file.
 * Keep all access to worksheet content behind this module so the source can change
 * without touching the renderer.
 */
import rawContent from '../../content/guide-content.json'
import type { GuideContent, GuideNode } from '../../schema/types'

const content = rawContent as GuideContent

export function getContent(): GuideContent {
  return content
}

export function getContentVersion(): string {
  return content.version
}

/** Depth-first walk over every node in document order. */
export function walk(nodes: GuideNode[], visit: (node: GuideNode, parents: GuideNode[]) => void) {
  const recurse = (list: GuideNode[], parents: GuideNode[]) => {
    for (const node of list) {
      visit(node, parents)
      if (node.children?.length) recurse(node.children, [...parents, node])
    }
  }
  recurse(nodes, [])
}

/** Flat index of every node by id, with its ancestor chain. */
export interface NodeRef {
  node: GuideNode
  parents: GuideNode[]
}

let indexCache: Map<string, NodeRef> | null = null

export function nodeIndex(): Map<string, NodeRef> {
  if (indexCache) return indexCache
  const map = new Map<string, NodeRef>()
  walk(content.sections, (node, parents) => map.set(node.id, { node, parents }))
  indexCache = map
  return map
}

export function findNode(id: string): NodeRef | undefined {
  return nodeIndex().get(id)
}

/**
 * The container layer for a node: its own `layer`, or the nearest ancestor's.
 * Answerable leaf blocks usually declare their own layer, but inheritance keeps
 * the model robust if Katie tags only the subsection.
 */
export function effectiveLayer(id: string): import('../../schema/types').Layer | undefined {
  const ref = nodeIndex().get(id)
  if (!ref) return undefined
  if (ref.node.layer) return ref.node.layer
  for (let i = ref.parents.length - 1; i >= 0; i--) {
    const l = ref.parents[i].layer
    if (l) return l
  }
  return undefined
}

/**
 * Navigable nodes: the subsection-level groups a user taps to (top-level section
 * -> its direct group children). These are the routing targets that keep any
 * subsection within three taps (menu -> section -> subsection).
 */
export interface NavSection {
  section: GuideNode
  subsections: GuideNode[]
}

export function navTree(): NavSection[] {
  return content.sections.map((section) => ({
    section,
    subsections: (section.children ?? []).filter((c) => c.type === 'group'),
  }))
}

/** Ordered flat list of navigable subsection ids, for prev/next and "recommended next". */
export function navOrder(): string[] {
  const order: string[] = []
  for (const { subsections } of navTree()) {
    for (const sub of subsections) order.push(sub.id)
  }
  return order
}

/** Text-routable target nodes for capture (a dictated note can land on these). */
const ROUTABLE_TYPES = new Set([
  'short_text',
  'long_text',
  'repeatable_list',
  'repeatable_row_table',
])

export interface RoutableNode {
  node: GuideNode
  sectionLabel: string
  subId: string
  subLabel: string
}

export function routableNodes(): RoutableNode[] {
  const out: RoutableNode[] = []
  for (const { section, subsections } of navTree()) {
    for (const sub of subsections) {
      const recurse = (n: GuideNode) => {
        for (const child of n.children ?? []) {
          if (child.type === 'group') recurse(child)
          else if (ROUTABLE_TYPES.has(child.type)) {
            out.push({ node: child, sectionLabel: section.label, subId: sub.id, subLabel: sub.label })
          }
        }
      }
      recurse(sub)
    }
  }
  return out
}

/**
 * The navigable subsection a node lives in (itself if it is one), as a route
 * target for cross-reference links. Walks the node and its ancestors and returns
 * the first id that is a navigable subsection; null if none.
 */
export function navSubsectionOf(id: string): string | null {
  const order = new Set(navOrder())
  const ref = nodeIndex().get(id)
  if (!ref) return order.has(id) ? id : null
  const chain = [ref.node, ...ref.parents].map((n) => n.id)
  return chain.find((nid) => order.has(nid)) ?? null
}

/**
 * The recommended journey: the worksheet's subsections grouped and ORDERED the
 * way the work actually happens, so a translator guiding themselves is never sent
 * to a synthesis step before its inputs exist. (Document order interleaves the
 * Section 0 synthesis pieces at the front; this moves them to the end.) The
 * section menu still lets anyone jump anywhere; this drives the home page, the
 * wizard, and the worksheet "Next" button.
 */
export interface JourneyStage {
  id: string
  title: string
  blurb: string
  subIds: string[]
}

const JOURNEY: JourneyStage[] = [
  {
    id: 'start',
    title: 'Step 1 — Your psalm',
    blurb: 'Say what this psalm is about and what it is doing.',
    subIds: ['s0.purpose'],
  },
  {
    id: 'find',
    title: 'Step 2 — Find local genres',
    blurb: 'List the songs and poems your people use, describe them, and choose one for this psalm.',
    subIds: ['s1a', 's1b', 's1c'],
  },
  {
    id: 'bigpicture',
    title: 'Step 3 — Study the genre: big picture',
    blurb: 'Learn how this genre is shaped, how it shows feelings, and how it links ideas.',
    subIds: ['s2a', 's2b', 's2c', 's2d', 's2e'],
  },
  {
    id: 'details',
    title: 'Step 4 — Study the genre: details',
    blurb: 'Look closely at its words, sounds, picture-language, and performance.',
    subIds: ['s3a', 's3b', 's3c', 's3d', 's3e', 's3f', 's3g'],
  },
  {
    id: 'together',
    title: 'Step 5 — Put it together and translate',
    blurb: 'Bring your notes back together, choose the genre, and write the translation.',
    subIds: ['s0.genre_choice', 's0.macro_notes', 's0.stylistic_notes', 's0.translation'],
  },
]

/** The journey stages, filtered to subsections that actually exist in the content. */
export function journey(): JourneyStage[] {
  const known = new Set(navOrder())
  return JOURNEY.map((stage) => ({
    ...stage,
    subIds: stage.subIds.filter((id) => known.has(id)),
  })).filter((stage) => stage.subIds.length > 0)
}

/** Flat subsection ids in journey (recommended-path) order. */
export function journeyOrder(): string[] {
  return journey().flatMap((stage) => stage.subIds)
}

export function nextNavId(currentId: string | null): string | null {
  const order = journeyOrder()
  if (!order.length) return null
  if (!currentId) return order[0]
  const i = order.indexOf(currentId)
  if (i === -1) return order[0]
  return i + 1 < order.length ? order[i + 1] : null
}
