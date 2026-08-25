/**
 * End-to-end proof that a jot ARCHIVE survives the real transport.
 *
 *   npx vite-node scripts/check-jot-archive-roundtrip.ts
 *
 * The unit tests pin the merge rule (presence of `updated_at` beats absence,
 * both directions, no clock comparisons). This drives the ACTUAL modules —
 * dismissCapturedNote -> outbox -> push_records -> pullProject -> mergeShards —
 * against the live project, which is the only way to prove push/pull do not
 * strip the new fields en route and that an archive lands on a device still
 * holding the plain row. Same one-throwaway-account pattern as
 * check-sync-roundtrip.ts.
 */
import 'fake-indexeddb/auto'
import { db } from '../src/lib/storage/db'
import {
  createCapturedNote,
  dismissCapturedNote,
  splitCapturedNote,
  splitSegments,
} from '../src/lib/storage/notes'
import { trackUpsert } from '../src/lib/sync/outbox'
import { pushOutbox } from '../src/lib/sync/supabase/push'
import { pullProject, resetCursor } from '../src/lib/sync/supabase/pull'
import { supabase } from '../src/lib/supabase/client'
import type { Project } from '../src/lib/types'

const REF = process.env.PROJECT_REF ?? 'ckorlrchryswnnrmuctr'
const PAT = process.env.SUPABASE_ACCESS_TOKEN
if (!PAT) {
  console.error('SUPABASE_ACCESS_TOKEN is required (source ~/.claude/secrets/supabase.env).')
  process.exit(1)
}
if (!supabase) {
  console.error('Supabase is not configured; check .env has VITE_SUPABASE_URL and ANON_KEY.')
  process.exit(1)
}

const BASE = `https://${REF}.supabase.co`
let failures = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
).json()
const SERVICE = keys.find((k: { name: string }) => k.name === 'service_role').api_key

const stamp = Date.now().toString(36)
const email = `jot-archive-${stamp}@example.com`
const password = `jot-archive-${stamp}-pw`

const created = await (
  await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
).json()

const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
if (signInError) {
  console.error('sign-in failed:', signInError.message)
  process.exit(1)
}

const PROJECT_ID = crypto.randomUUID()
const now = () => new Date().toISOString()
const ctx = { projectId: PROJECT_ID, focusTextId: 'f1', genreId: 'g1', worksheetId: 'w1' }

function project(): Project {
  return {
    id: PROJECT_ID,
    name: 'Jot archive round-trip',
    culture: 'Budaya uji',
    language: 'Bahasa uji',
    languages: ['id'],
    team_members: [],
    scope: 'narrow',
    config_version: 1,
    is_sensitive: false,
    created_at: now(),
    updated_at: now(),
  } as Project
}

async function becomeDevice(author: string) {
  await Promise.all([db.outbox.clear(), db.meta.clear()])
  await db.meta.put({ key: 'syncAuthorId', value: author })
  await resetCursor(PROJECT_ID)
}

try {
  // ------------------------------------------ device A captures a jot, pushes
  console.log('==> Device A: capture a jot and push it')
  await db.meta.put({ key: 'syncAuthorId', value: 'device-a' })

  const p = project()
  await db.projects.put(p)
  await trackUpsert('projects', p)
  const note = await createCapturedNote(ctx, 'Jawaban yang melenceng', 'id')
  check('the fresh note carries no updated_at', note.updated_at === undefined)

  const { error: pubErr } = await supabase.rpc('create_shared_project', {
    p_project: PROJECT_ID,
    p_name: p.name,
  })
  check('A publishes the project', !pubErr, pubErr?.message)
  const pushed = await pushOutbox(new Set([PROJECT_ID]))
  check('A pushes note + project', pushed.pushed >= 2, `pushed=${pushed.pushed}`)

  // -------------------------------------------- device B pulls, archives back
  console.log('==> Device B: pull the note, archive it, push the archive')
  await db.capturedNotes.clear()
  await becomeDevice('device-b')
  await pullProject(PROJECT_ID, 'device-b')
  const onB = await db.capturedNotes.get(note.id)
  check('B receives the note', onB?.raw_text === 'Jawaban yang melenceng')
  check('B receives it un-archived', !onB?.dismissed_at)

  const archived = await dismissCapturedNote(onB!)
  check('B stamps dismissed_at + updated_at', !!archived.dismissed_at && !!archived.updated_at)
  const pushedB = await pushOutbox(new Set([PROJECT_ID]))
  check('B pushes the archive', pushedB.pushed >= 1, `pushed=${pushedB.pushed}`)

  // ----------------- device A still holds the PLAIN row; the archive must win
  console.log('==> Device A: plain local row, pulls the archive')
  await becomeDevice('device-a')
  // One process plays both devices, so B's archive is sitting in the shared
  // Dexie; restore A's actual local state — the original plain row — first.
  await db.capturedNotes.put({ ...note })
  const beforePull = await db.capturedNotes.get(note.id)
  check('A still holds its plain row', !!beforePull && !beforePull.dismissed_at)
  await pullProject(PROJECT_ID, 'device-a')
  const afterPull = await db.capturedNotes.get(note.id)
  check('the archive applied on A (presence beats absence)', !!afterPull?.dismissed_at)
  check('raw_text stayed pinned', afterPull?.raw_text === 'Jawaban yang melenceng')

  // -------------- an old-client replay of the plain row must not resurrect it
  console.log('==> Replay: A re-enqueues the original plain row (old-client shape)')
  await trackUpsert('capturedNotes', {
    id: note.id,
    project_id: PROJECT_ID,
    raw_text: 'Jawaban yang melenceng',
    source_language: 'id',
    created_at: now(), // deliberately NEWER than the archive: the skew case
  })
  await pushOutbox(new Set([PROJECT_ID]))
  await becomeDevice('device-b')
  await pullProject(PROJECT_ID, 'device-b')
  const onBAfterReplay = await db.capturedNotes.get(note.id)
  check('the replay did not resurrect the note on B', !!onBAfterReplay?.dismissed_at)

  // ------------- skew: a fast-clock capture must not out-LWW a real archive
  // The client merge is presence-based, but the SERVER's push_records guard is
  // tuple LWW on the envelope's updated_at, and a plain jot's envelope carries
  // the capturer's created_at. This is the case the 13-check run above cannot
  // see: both simulated devices share one process clock.
  console.log('==> Skew: fast-clock capture, correct-clock archive')
  const fastNote = {
    id: crypto.randomUUID(),
    project_id: PROJECT_ID,
    raw_text: 'Jam saya terlalu cepat',
    source_language: 'id',
    created_at: new Date(Date.now() + 10 * 60_000).toISOString(), // 10 min fast
  }
  await db.capturedNotes.put(fastNote)
  await trackUpsert('capturedNotes', fastNote)
  const pushedFast = await pushOutbox(new Set([PROJECT_ID]))
  check('B (fast clock) pushes the capture', pushedFast.pushed >= 1)

  await becomeDevice('device-a')
  await pullProject(PROJECT_ID, 'device-a')
  const fastOnA = await db.capturedNotes.get(fastNote.id)
  check('A receives the fast-clock note', fastOnA?.raw_text === 'Jam saya terlalu cepat')
  const fastArchived = await dismissCapturedNote(fastOnA!)
  check(
    'the archive stamp out-sorts the fast created_at',
    !!fastArchived.updated_at && fastArchived.updated_at > fastNote.created_at,
  )
  const pushedArchive = await pushOutbox(new Set([PROJECT_ID]))
  check('A pushes the archive', pushedArchive.pushed >= 1)

  // The server guard is the thing under test: the archive must actually have
  // replaced the capture row in sync_records, not been silently skipped.
  const serverRows = (await (
    await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `select data->>'dismissed_at' as dismissed_at from public.sync_records where record_id = '${fastNote.id}'`,
      }),
    })
  ).json()) as Array<{ dismissed_at: string | null }>
  check(
    'the archive landed server-side (LWW guard did not skip it)',
    Array.isArray(serverRows) && !!serverRows[0]?.dismissed_at,
    JSON.stringify(serverRows),
  )

  await becomeDevice('device-b')
  // Shared fake-indexeddb again: restore B's real local state (the plain row).
  await db.capturedNotes.put({ ...fastNote })
  await pullProject(PROJECT_ID, 'device-b')
  const fastOnB = await db.capturedNotes.get(fastNote.id)
  check('the archive reached the fast-clock device', !!fastOnB?.dismissed_at)

  // -------------- split: segments survive the transport carrying split_from
  console.log('==> Split: B splits a two-paragraph note; A receives the pieces')
  const longNote = await createCapturedNote(ctx, 'Bagian pertama.\n\nBagian kedua.', 'id')
  const segs = await splitCapturedNote(ctx, longNote, splitSegments(longNote.raw_text))
  check('split created two segments locally', segs.length === 2)
  const pushedSplit = await pushOutbox(new Set([PROJECT_ID]))
  check('B pushes segments + archive', pushedSplit.pushed >= 3, `pushed=${pushedSplit.pushed}`)

  await becomeDevice('device-a')
  // Shared fake-indexeddb: A's real local state is the plain original, no segments.
  for (const s of segs) await db.capturedNotes.delete(s.id)
  await db.capturedNotes.put({ ...longNote })
  await pullProject(PROJECT_ID, 'device-a')
  const segsOnA = await Promise.all(segs.map((s) => db.capturedNotes.get(s.id)))
  check('both segments arrived on A', segsOnA.every(Boolean))
  check(
    'split_from survived the transport',
    segsOnA.every((s) => s?.split_from === longNote.id),
  )
  const originalOnA = await db.capturedNotes.get(longNote.id)
  check('the original arrived archived on A', !!originalOnA?.dismissed_at)
} catch (err) {
  failures++
  console.log(`    FAIL harness error — ${(err as Error).message}`)
} finally {
  await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `delete from public.shared_projects where project_id = '${PROJECT_ID}'`,
    }),
  }).catch(() => {})
  await fetch(`${BASE}/auth/v1/admin/users/${created.id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  }).catch(() => {})
}

console.log(failures === 0 ? '\n    jot archive round trip OK' : `\n    ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
