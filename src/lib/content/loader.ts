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
  // Chrome nodes are indexed for findNode/edit-in-place, but never appear in
  // navTree/navOrder/progress (those walk content.sections directly).
  walk(content.chrome ?? [], (node, parents) => map.set(node.id, { node, parents }))
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

/**
 * Genre-scoped research grouped by the section it lives under, for the per-genre
 * checklist on the genres hub (e.g. "Details" = 1B, "Big picture" = Section 2,
 * "Style & detail" = Section 3). Derived from the content so it tracks any
 * reordering or splitting of the genre sections.
 */
export interface GenreStage {
  sectionId: string
  sectionLabel: string
  subIds: string[]
}

export function genreLayerStages(): GenreStage[] {
  const out: GenreStage[] = []
  for (const { section, subsections } of navTree()) {
    const subIds = subsections.filter((s) => effectiveLayer(s.id) === 'genre').map((s) => s.id)
    if (subIds.length) out.push({ sectionId: section.id, sectionLabel: section.label, subIds })
  }
  return out
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
 * The recommended journey: the worksheet's subsections grouped into the two
 * WORKSPACES of the process and ordered the way the work actually happens.
 * Workspace 1 (Find & Describe Local Genres) is the standalone ethnography;
 * Workspace 2 (Create / Translate) consumes it for one passage. The section menu
 * still lets anyone jump anywhere; this drives the home chart, the wizard, and
 * the worksheet "Next" button.
 */
export type WorkspaceId = 'w1' | 'w2'

export interface JourneyStage {
  id: string
  workspace: WorkspaceId
  title: string
  blurb: string
  subIds: string[]
  /** Route for stages that are an app page rather than worksheet subsections. */
  route?: string
  /**
   * The content node id this stage's title is derived from, so the UI can tag
   * the rendered title for edit-in-place. Set by `journey()`; undefined only
   * if no source node resolved (title then falls back to the literal below).
   */
  titleNodeId?: string
}

// Fallback titles only. The live title for each stage is derived in journey()
// from its source content node (a single subsection, or a chrome node for the
// multi-page / route-only stages), so editing a page heading propagates here.
// These literals mirror the current content labels so the fallback path renders
// identically if a node is ever missing.
const JOURNEY: JourneyStage[] = [
  {
    id: 'find',
    workspace: 'w1',
    title: '1a: Find Local Genres',
    blurb: 'List the genres your people use — the songs, poems, stories, and chants people still enjoy and make.',
    subIds: ['s1a'],
  },
  {
    id: 'describe',
    workspace: 'w1',
    title: '1b–1e: Describe a Genre',
    blurb: 'For each genre: its purposes, its social side, its big picture, and its style details.',
    subIds: ['s1b', 's2eth', 's2b', 's2a', 's2c', 's2d', 's3a', 's3b', 's3c', 's3d', 's3e', 's3f'],
  },
  {
    id: 'summary',
    workspace: 'w1',
    title: '1f: Genre Summary Table',
    blurb: 'All your genres side by side, with purpose coverage at a glance.',
    subIds: [],
    route: '/summary',
  },
  {
    id: 'setup',
    workspace: 'w2',
    title: '2a: Focus on {passage}',
    blurb: 'Name the passage and say how people will use the translation.',
    subIds: ['s0.setup'],
  },
  {
    id: 'choose',
    workspace: 'w2',
    title: '2b: Choose a Genre',
    blurb: 'Compare purposes first, shortlist the top 3, weigh the social factors, and lock one in.',
    subIds: ['s0.genre_choice'],
  },
  {
    id: 'macro',
    workspace: 'w2',
    title: '2c: The Big Picture — Compare & Decide',
    blurb: 'Compare the passage with the genre across the four big-picture areas and decide.',
    subIds: ['s0.macro_notes'],
  },
  {
    id: 'style',
    workspace: 'w2',
    title: '2d: The Style — Compare & Decide',
    blurb: "Plan how to achieve the genre's Required features with this passage.",
    subIds: ['s0.stylistic_notes'],
  },
  {
    id: 'draft',
    workspace: 'w2',
    title: '2e: Decisions & First Draft',
    blurb: 'See every decision in one place and make a first draft, in text or voice.',
    subIds: ['s0.translation'],
  },
]

/**
 * Stages whose title has no single owning subsection (a multi-page group, or a
 * route-only page) take their title from a `chrome` node instead.
 */
const STAGE_TITLE_NODE: Partial<Record<string, string>> = {
  describe: 'chrome.describe',
  summary: 'chrome.summary',
}

/** The journey stages, filtered to subsections that exist, with titles derived from content. */
export function journey(): JourneyStage[] {
  const known = new Set(navOrder())
  return JOURNEY.map((stage) => {
    const subIds = stage.subIds.filter((id) => known.has(id))
    const titleNodeId = STAGE_TITLE_NODE[stage.id] ?? (subIds.length === 1 ? subIds[0] : undefined)
    const derived = titleNodeId ? findNode(titleNodeId)?.node.label : undefined
    return { ...stage, subIds, titleNodeId, title: derived ?? stage.title }
  }).filter((stage) => stage.subIds.length > 0 || stage.route)
}

export interface Workspace {
  id: WorkspaceId
  title: string
  blurb: string
  stages: JourneyStage[]
  /** The content node id the workspace title derives from (its top-level section). */
  titleNodeId: string
}

/** The two workspaces of the process, each with its ordered stages. */
export function workspaces(): Workspace[] {
  const stages = journey()
  return [
    {
      id: 'w1',
      title: findNode('s1')?.node.label ?? 'Find & Describe Local Genres',
      titleNodeId: 's1',
      blurb: 'The ethnography: learn what genres your people have. Reusable for every passage.',
      stages: stages.filter((s) => s.workspace === 'w1'),
    },
    {
      id: 'w2',
      title: findNode('s0')?.node.label ?? 'Create / Translate',
      titleNodeId: 's0',
      blurb: "Bring one passage to life in one of your community's genres.",
      stages: stages.filter((s) => s.workspace === 'w2'),
    },
  ]
}

/**
 * Splits a stage/section title into its number chip and the rest, e.g.
 * "2c: The Big Picture — Compare & Decide" -> ["2c", "The Big Picture — Compare & Decide"].
 * Splits at the FIRST of ": " or " — " (a label may contain both). Returns a
 * bullet chip when neither separator is present. Resolve `{genre}`/`{passage}`
 * tokens BEFORE calling — they never appear in the number prefix.
 */
export function splitStageTitle(title: string): [string, string] {
  const colon = title.indexOf(': ')
  const dash = title.indexOf(' — ')
  const candidates = [
    { i: colon, len: 2 },
    { i: dash, len: 3 },
  ].filter((c) => c.i !== -1)
  if (candidates.length === 0) return ['•', title]
  const first = candidates.reduce((a, b) => (b.i < a.i ? b : a))
  return [title.slice(0, first.i), title.slice(first.i + first.len)]
}

/** The route a journey stage opens: its page route, or its first subsection. */
export function stageRoute(stage: JourneyStage): string {
  const first = stage.subIds[0]
  return stage.route ?? (first && SUB_PAGE_ROUTES[first]) ?? `/worksheet/${first}`
}

/**
 * Subsections whose worksheet route is superseded by a dedicated page (the
 * Workspace 2 chooser and compare pages). WorksheetView redirects these, so
 * every old link, xref, and Next button lands on the right page.
 */
export const SUB_PAGE_ROUTES: Record<string, string> = {
  's0.genre_choice': '/choose',
  's0.macro_notes': '/macro',
  's0.stylistic_notes': '/style',
}

/** The route that opens a subsection: its dedicated page, or the generic view. */
export function routeForSub(subId: string): string {
  return SUB_PAGE_ROUTES[subId] ?? `/worksheet/${subId}`
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
