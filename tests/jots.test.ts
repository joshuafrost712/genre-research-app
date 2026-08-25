import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The outbox no-ops when Supabase is unconfigured, and whether the local .env
// configures it differs between machines. Pin it on so the replication
// assertions below are deterministic everywhere.
vi.mock('../src/lib/supabase/client', () => ({
  isSupabaseConfigured: () => true,
  supabase: null,
}))

import { db } from '../src/lib/storage/db'
import { testContext } from './helpers/context'
import {
  createCapturedNote,
  dismissCapturedNote,
  noteAuthorOf,
  restoreCapturedNote,
  routeNoteToNode,
} from '../src/lib/storage/notes'
import { listPendingNotes } from '../src/routing/operations'
import { findEntry } from '../src/lib/storage/entries'
import { findNode } from '../src/lib/content/loader'

async function clearDb() {
  await Promise.all([
    db.projects.clear(),
    db.focusTexts.clear(),
    db.genres.clear(),
    db.worksheets.clear(),
    db.capturedNotes.clear(),
    db.entries.clear(),
    db.meta.clear(),
    db.outbox.clear(),
  ])
}

describe('Jot archive/restore', () => {
  beforeEach(clearDb)

  it('archive stamps dismissed_at + updated_at; restore clears dismissed_at and keeps updated_at', async () => {
    const ctx = await testContext()
    const note = await createCapturedNote(ctx, 'stray answer')
    expect(note.updated_at).toBeUndefined() // plain rows never carry it

    const archived = await dismissCapturedNote(note)
    expect(archived.dismissed_at).toBeTruthy()
    expect(archived.updated_at).toBe(archived.dismissed_at)

    const restored = await restoreCapturedNote(archived)
    expect(restored.dismissed_at).toBeUndefined()
    expect(restored.updated_at).toBeTruthy() // presence survives, so a later archive still wins
    // The Dexie-undefined gotcha: the key must be truly gone from the stored row.
    const raw = await db.capturedNotes.get(note.id)
    expect(raw && 'dismissed_at' in raw && raw.dismissed_at !== undefined).toBe(false)
  })

  it('archived jots leave the AI-routing pending queue; restore returns them', async () => {
    const ctx = await testContext()
    const note = await createCapturedNote(ctx, 'unrouted thought')
    expect((await listPendingNotes(ctx)).map((n) => n.id)).toContain(note.id)

    const archived = await dismissCapturedNote(note)
    expect((await listPendingNotes(ctx)).map((n) => n.id)).not.toContain(note.id)

    await restoreCapturedNote(archived)
    expect((await listPendingNotes(ctx)).map((n) => n.id)).toContain(note.id)
  })

  it('routeNoteToNode appends to an answered scalar with a newline and stamps provenance', async () => {
    const ctx = await testContext()
    const node = findNode('s2a.how')!.node
    const first = await createCapturedNote(ctx, 'Performed at funerals')
    await routeNoteToNode(ctx, first, node)
    const second = await createCapturedNote(ctx, 'Also at memorials')
    await routeNoteToNode(ctx, second, node)

    const e = await findEntry(ctx, 's2a.how', 'genre')
    expect(e?.text).toBe('Performed at funerals\nAlso at memorials')
    expect(e?.captured_note_id).toBe(second.id)
    expect(e?.routing_status).toBe('confirmed')
  })

  it('stamps author_id and author_label on create; guests carry neither', async () => {
    const ctx = await testContext()
    const authored = await createCapturedNote(
      ctx,
      'who said this',
      undefined,
      noteAuthorOf({ id: 'u1', email: 'katie@example.org', name: 'Katie' }),
    )
    expect(authored.author_id).toBe('u1')
    expect(authored.author_label).toBe('Katie')

    // Label falls back to email when there is no display name.
    expect(noteAuthorOf({ id: 'u2', email: 'anon@example.org' })).toEqual({
      id: 'u2',
      label: 'anon@example.org',
    })

    const guest = await createCapturedNote(ctx, 'guest note', undefined, noteAuthorOf(null))
    expect(guest.author_id).toBeUndefined()
    expect(guest.author_label).toBeUndefined()
  })

  it('archive of a future-created_at note stamps past it (skewed capturer clock)', async () => {
    // The server's push_records does tuple LWW on the envelope's updated_at,
    // and a plain jot's envelope carries created_at from the CAPTURER's clock.
    // If archive stamped bare now(), a capture from a fast clock would out-sort
    // it server-side and the archive would silently never replicate.
    const ctx = await testContext()
    const note = await createCapturedNote(ctx, 'from a fast clock')
    const future = new Date(Date.now() + 10 * 60_000).toISOString()
    await db.capturedNotes.update(note.id, { created_at: future })
    const skewed = (await db.capturedNotes.get(note.id))!

    const archived = await dismissCapturedNote(skewed)
    expect(archived.updated_at! > future).toBe(true)

    // The replication envelope must carry the bumped stamp too.
    const rows = await db.outbox.toArray()
    const last = rows[rows.length - 1]
    expect(last.updated_at > future).toBe(true)
  })

  it('restore stamps past the archive it undoes', async () => {
    const ctx = await testContext()
    const note = await createCapturedNote(ctx, 'archive then restore')
    const futureArchive = new Date(Date.now() + 10 * 60_000).toISOString()
    await db.capturedNotes.update(note.id, {
      dismissed_at: futureArchive,
      updated_at: futureArchive,
    })
    const archived = (await db.capturedNotes.get(note.id))!

    const restored = await restoreCapturedNote(archived)
    expect(restored.dismissed_at).toBeUndefined()
    expect(restored.updated_at! > futureArchive).toBe(true)
  })

  it('archive and restore both enqueue the whole row for replication', async () => {
    const ctx = await testContext()
    const note = await createCapturedNote(ctx, 'sync me')
    const before = await db.outbox.count()

    const archived = await dismissCapturedNote(note)
    await restoreCapturedNote(archived)

    const rows = await db.outbox.toArray()
    // One enqueue per mutation (create already added one before `before`).
    expect(rows.length).toBe(before + 2)
    const last = rows[rows.length - 1]
    expect(last.table).toBe('capturedNotes')
    expect(last.op).toBe('upsert')
    expect((last.data as { updated_at?: string }).updated_at).toBeTruthy()
  })
})
