// The routing contract — runtime-agnostic, no SDK, no metered API.
//
// Like cairn, this app does NOT call a metered Claude API. AI routing is done by
// Claude through a Claude Max subscription, operating on a GitHub repo (or via a
// token-free copy/paste path). This module is the single source of truth for what
// that routing must do, consumed by both the workspace generator (src/ai/
// workspace.ts) and the in-app importer (src/routing/), so the spec the app
// validates against is exactly the spec Claude was given.

// Instructions Claude follows. Rendered verbatim into routing/ROUTING.md.
export const ROUTING_RULES = `You are the routing step of a local-genres research tool for Bible translation. A facilitator dictated a free-form observation while interviewing a local genre expert. Your job is to propose where that observation belongs in the research worksheet.

Rules:
- Produce one placement per distinct claim. Split compound observations into separate placements.
- Only use node ids from the provided "routable nodes" list. If a claim does not fit any provided node, omit it (do not invent a node id).
- A single observation may belong to more than one node; emit a placement for each.
- In "text", write the concise wording to record in that field, in clear English, faithful to what the expert said. Do not add information the observation does not contain.
- confidence: "high" only when the node fit and wording are clearly supported; "low" when the node is a stretch or the observation is thin.
- Set needs_review true whenever confidence is "low" or you had to interpret. A human confirms every placement, so never decide silently.
- "reason" is a short phrase on why this node fits.
- You propose; the team decides. Return only placements grounded in the observation. An empty list is a valid answer.`

// JSON schema each routed output file must match. Kept as a plain object so it
// serializes to routing/reference/schema.json for Claude to read.
export const PLACEMENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    placements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          node_id: { type: 'string', description: 'One of the provided routable node ids' },
          text: { type: 'string', description: 'Concise English wording to record in that field' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          needs_review: { type: 'boolean' },
          reason: { type: 'string', description: 'Short phrase: why this node fits' },
        },
        required: ['node_id', 'text', 'confidence', 'needs_review', 'reason'],
      },
    },
  },
  required: ['placements'],
} as const

export interface RoutedPlacement {
  node_id: string
  text: string
  confidence: 'low' | 'medium' | 'high'
  needs_review: boolean
  reason: string
}

/**
 * Runtime validation of one placement produced by Claude. The output is
 * Claude-authored JSON from a repo / paste, so the app cannot trust it blindly.
 * `validNodeIds` rejects placements that target a node the app does not know.
 */
export function validatePlacement(
  p: unknown,
  validNodeIds: Set<string>,
): { ok: true; value: RoutedPlacement } | { ok: false; reason: string } {
  if (typeof p !== 'object' || p === null) return { ok: false, reason: 'not an object' }
  const r = p as Record<string, unknown>
  const nodeId = r.node_id
  if (typeof nodeId !== 'string') return { ok: false, reason: 'missing node_id' }
  if (!validNodeIds.has(nodeId)) return { ok: false, reason: `unknown node_id ${nodeId}` }
  if (typeof r.text !== 'string' || !r.text.trim()) return { ok: false, reason: 'missing text' }
  if (!['low', 'medium', 'high'].includes(r.confidence as string))
    return { ok: false, reason: 'bad confidence' }
  if (typeof r.needs_review !== 'boolean') return { ok: false, reason: 'needs_review not boolean' }
  const reason = typeof r.reason === 'string' ? r.reason : ''
  return {
    ok: true,
    value: {
      node_id: nodeId,
      text: r.text,
      confidence: r.confidence as RoutedPlacement['confidence'],
      needs_review: r.needs_review,
      reason,
    },
  }
}
