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

export function nextNavId(currentId: string | null): string | null {
  const order = navOrder()
  if (!order.length) return null
  if (!currentId) return order[0]
  const i = order.indexOf(currentId)
  if (i === -1) return order[0]
  return i + 1 < order.length ? order[i + 1] : null
}
