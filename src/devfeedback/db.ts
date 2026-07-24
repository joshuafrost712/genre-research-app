import Dexie, { type EntityTable } from 'dexie'

/**
 * Storage for in-app dev feedback. Deliberately a SEPARATE IndexedDB database
 * from the app's production store: feedback is a development concern and must
 * never bump the production schema version, share any sync, or otherwise
 * entangle with real data. Wiping this DB has zero effect on the app's data.
 */
export type Importance = 'high' | 'medium' | 'low'

export interface FeedbackComment {
  id: string
  /** Route the comment was made on, e.g. "/capture/abc". */
  route: string
  /** The highlighted text the comment is anchored to (empty for a page-level note). */
  selectionText: string
  /** Human-readable hint at where on the page this is (nearest heading / label). */
  locationLabel: string
  /** The actual feedback. */
  comment: string
  importance: Importance
  /** 'open' = still in the working set; 'sent' = already shipped in a batch. */
  status: 'open' | 'sent'
  createdAt: string
  updatedAt: string

  // Who left the comment (beta mode). Stamped from the signed-in Supabase user
  // at save time so a batch can be attributed to the person who submitted it.
  // Absent for anonymous/dev feedback.
  authorEmail?: string
  authorId?: string
  authorName?: string

  // Text-edit records (spec 10 WP9). kind 'edit' carries a structured
  // old→new change to one guide-content field; absent kind means 'comment'.
  kind?: 'comment' | 'edit'
  /** guide-content node id the edit targets. */
  nodeId?: string
  /** Which field of the node: label | guidance | footnote | example | help. */
  field?: string
  /** The template text (with {genre}/{passage} tokens) before the edit. */
  oldText?: string
  /** The template text after the edit. */
  newText?: string
  /** True when the dev server applied it to guide-content.json immediately. */
  applied?: boolean
}

class FeedbackDB extends Dexie {
  comments!: EntityTable<FeedbackComment, 'id'>

  constructor() {
    super('genre-dev-feedback')
    this.version(1).stores({
      comments: 'id, status, importance, route, createdAt',
    })
  }
}

export const fdb = new FeedbackDB()

/** Sort order so "high" floats to the top of the manager. */
export const IMPORTANCE_ORDER: Record<Importance, number> = { high: 0, medium: 1, low: 2 }

function uid(): string {
  // crypto.randomUUID is available in all browsers this PWA targets.
  return crypto.randomUUID()
}

export async function addComment(
  draft: Pick<FeedbackComment, 'route' | 'selectionText' | 'locationLabel' | 'comment' | 'importance'> &
    Partial<Pick<FeedbackComment, 'nodeId' | 'field' | 'authorEmail' | 'authorId' | 'authorName'>>,
): Promise<void> {
  const now = new Date().toISOString()
  await fdb.comments.add({
    id: uid(),
    status: 'open',
    createdAt: now,
    updatedAt: now,
    ...draft,
  })
}

/** Record a text edit (applied or pending) so the batch documents it. */
export async function addEdit(draft: {
  route: string
  locationLabel: string
  nodeId: string
  field: string
  oldText: string
  newText: string
  applied: boolean
}): Promise<void> {
  const now = new Date().toISOString()
  await fdb.comments.add({
    id: uid(),
    status: 'open',
    createdAt: now,
    updatedAt: now,
    kind: 'edit',
    route: draft.route,
    selectionText: draft.oldText,
    locationLabel: draft.locationLabel,
    comment: draft.applied
      ? `Text edited in place (already applied to guide-content.json).`
      : `Text edit suggestion (NOT yet applied — apply to guide-content.json).`,
    importance: 'medium',
    nodeId: draft.nodeId,
    field: draft.field,
    oldText: draft.oldText,
    newText: draft.newText,
    applied: draft.applied,
  })
}

export async function updateComment(
  id: string,
  patch: Partial<Pick<FeedbackComment, 'comment' | 'importance'>>,
): Promise<void> {
  await fdb.comments.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export async function deleteComment(id: string): Promise<void> {
  await fdb.comments.delete(id)
}

/** Mark a set of comments as shipped after a batch is sent. */
export async function markSent(ids: string[]): Promise<void> {
  const now = new Date().toISOString()
  await fdb.comments.bulkUpdate(ids.map((id) => ({ key: id, changes: { status: 'sent', updatedAt: now } })))
}
