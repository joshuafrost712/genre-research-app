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
}

const JOURNEY: JourneyStage[] = [
  {
    id: 'find',
    workspace: 'w1',
    title: '1a–1c — Find & describe genres',
    blurb: 'List the genres your people use; record what each is about, its purposes, and its social side.',
    subIds: ['s1a', 's1b', 's2eth'],
  },
  {
    id: 'bigpicture',
    workspace: 'w1',
    title: '1d — The big picture',
    blurb: 'How the genre is shaped: its parts, what stands out, feelings, and connections.',
    subIds: ['s2b', 's2a', 's2c', 's2d'],
  },
  {
    id: 'details',
    workspace: 'w1',
    title: '1e — Style & details',
    blurb: 'Words, discourse, sounds, picture-language, performance — and which features are Required.',
    subIds: ['s3a', 's3b', 's3c', 's3d', 's3e', 's3f'],
  },
  {
    id: 'summary',
    workspace: 'w1',
    title: '1f — Genre summary table',
    blurb: 'All your genres side by side, with purpose coverage at a glance.',
    subIds: [],
    route: '/summary',
  },
  {
    id: 'setup',
    workspace: 'w2',
    title: '2a — Your passage',
    blurb: 'Name the passage and say how people will use the translation.',
    subIds: ['s0.setup'],
  },
  {
    id: 'choose',
    workspace: 'w2',
    title: '2b — Choose a genre',
    blurb: 'Compare purposes first, shortlist the top 3, weigh the social factors, and lock one in.',
    subIds: ['s0.genre_choice'],
    route: '/choose',
  },
  {
    id: 'macro',
    workspace: 'w2',
    title: '2c — The big picture',
    blurb: 'Compare the passage with the genre across the four big-picture areas and decide.',
    subIds: ['s0.macro_notes'],
  },
  {
    id: 'style',
    workspace: 'w2',
    title: '2d — The style',
    blurb: "Plan how to achieve the genre's Required features with this passage.",
    subIds: ['s0.stylistic_notes'],
  },
  {
    id: 'draft',
    workspace: 'w2',
    title: '2e — Decisions & first draft',
    blurb: 'See every decision in one place and make a first draft, in text or voice.',
    subIds: ['s0.translation'],
  },
]

/** The journey stages, filtered to subsections that actually exist in the content. */
export function journey(): JourneyStage[] {
  const known = new Set(navOrder())
  return JOURNEY.map((stage) => ({
    ...stage,
    subIds: stage.subIds.filter((id) => known.has(id)),
  })).filter((stage) => stage.subIds.length > 0 || stage.route)
}

export interface Workspace {
  id: WorkspaceId
  title: string
  blurb: string
  stages: JourneyStage[]
}

/** The two workspaces of the process, each with its ordered stages. */
export function workspaces(): Workspace[] {
  const stages = journey()
  return [
    {
      id: 'w1',
      title: 'Find & Describe Local Genres',
      blurb: 'The ethnography: learn what genres your people have. Reusable for every passage.',
      stages: stages.filter((s) => s.workspace === 'w1'),
    },
    {
      id: 'w2',
      title: 'Create / Translate',
      blurb: 'Take one passage (a psalm or other Scripture) into a genre you have described.',
      stages: stages.filter((s) => s.workspace === 'w2'),
    },
  ]
}

/** The route a journey stage opens: its page route, or its first subsection. */
export function stageRoute(stage: JourneyStage): string {
  return stage.route ?? `/worksheet/${stage.subIds[0]}`
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
