/**
 * Surfacing for the one thing last-write-wins costs you.
 *
 * `merge.ts` already keeps the loser: when a teammate's row replaces different,
 * non-empty local text, `recordOverwrite` writes the previous value into
 * `db.history`. So the work is recoverable. What was missing is anyone finding
 * out — the text simply changed on screen mid-session, which reads as the app
 * eating an answer even though the answer is sitting in a table one query away.
 *
 * This is the channel from the merge step to the UI. It is a plain in-memory
 * emitter because the sync engine runs in the same tab as the components: no
 * BroadcastChannel, no storage events, no serialisation. A notice not consumed is
 * simply dropped — this is a courtesy on top of a durable history row, never the
 * record of truth.
 */

export interface OverwriteNotice {
  /** Dexie id of the entry that was replaced, for the Undo write. */
  entryId: string
  projectId: string
  nodeId: string
  cellKey?: string
  /** What this device had before the remote row landed. */
  prevText?: string
  prevValue?: string
}

const subscribers = new Set<(n: OverwriteNotice) => void>()

export function emitOverwrite(notice: OverwriteNotice): void {
  for (const cb of subscribers) cb(notice)
}

export function subscribeOverwrites(cb: (n: OverwriteNotice) => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
