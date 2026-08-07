#!/usr/bin/env node
/**
 * The gate for "my answer changed under me and nothing said why."
 *
 *   npm run dev                                  # in another terminal
 *   node scripts/check-overwrite-toast.mjs
 *
 * Unit tests cover the merge emitting a notice and the restore writing a newer
 * row (tests/overwrite-notice.test.ts). They cannot cover the half that failed
 * last time: a component that renders nothing. So this drives the real app,
 * seeds a real collision through the real merge path, and asserts on visible
 * text and a real click.
 *
 * Runs against the DEV SERVER on purpose. It reaches into `/src/...` modules to
 * stage the collision deterministically, which a minified production bundle has
 * no names for. The components and the merge under test are the same either way;
 * what is dev-only is the staging, not the code being graded.
 */
import { launch } from './lib/browser.mjs'

const APP_URL = (process.argv[2] ?? 'http://localhost:5173/').replace(/\/?$/, '/')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const BODY_TEXT = `return document.body.innerText.replace(/\\s+/g, ' ')`

/**
 * Put a local answer in place, then merge a newer remote row over it — exactly
 * what a teammate typing in the same cell two seconds later produces.
 */
const STAGE_COLLISION = `
  const { db } = await import('/src/lib/storage/db.ts')
  const { mergeShards } = await import('/src/lib/sync/merge.ts')
  const { navTree } = await import('/src/lib/content/loader.ts')

  // A real answerable node, so the toast can name where it happened rather than
  // printing a raw id at somebody.
  const nodeId = navTree()[0].subsections[0].id

  const mine = {
    id: 'collision-entry',
    project_id: 'p-collision',
    node_id: nodeId,
    text: 'what I wrote',
    routing_status: 'confirmed',
    schema_version: '1',
    sync_status: 'synced',
    created_at: '2026-08-07T10:00:00.000Z',
    updated_at: '2026-08-07T10:00:00.000Z',
  }
  await db.entries.put(mine)

  await mergeShards([{
    schemaVersion: '1',
    authorId: 'teammate',
    updatedAt: '2026-08-07T11:00:00.000Z',
    records: {
      'entries/collision-entry': {
        table: 'entries',
        op: 'upsert',
        updated_at: '2026-08-07T11:00:00.000Z',
        data: { ...mine, text: 'what they wrote', updated_at: '2026-08-07T11:00:00.000Z' },
      },
    },
  }])

  const after = await db.entries.get('collision-entry')
  return after.text
`

const browser = await launch('overwrite')
try {
  console.log(`\n  ${APP_URL}`)
  await browser.goto(APP_URL, 3500)

  const merged = await browser.evaluate(STAGE_COLLISION)
  check(
    'the teammate’s edit wins the merge, as last-write-wins should',
    merged === 'what they wrote',
    `entry text is ${JSON.stringify(merged)}`,
  )

  const shown = await browser.until(
    `/replaced your answer/i.test(document.body.innerText)`,
    5000,
  )
  check(
    'the replacement is announced instead of happening silently',
    shown.ok,
    'no toast appeared within 5s of the merge',
  )

  if (shown.ok) {
    const text = await browser.evaluate(BODY_TEXT)
    check(
      'the toast names where it happened',
      !/undefined|null/i.test(text.match(/replaced your answer[^.]*/i)?.[0] ?? ''),
      'the location read as undefined',
    )

    const clicked = await browser.evaluate(`
      const btn = [...document.querySelectorAll('button')]
        .find((b) => /restore mine/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    `)
    check('the toast offers a restore', clicked === true)

    if (clicked) {
      const restored = await browser.until(
        `(async () => {
           const { db } = await import('/src/lib/storage/db.ts')
           const e = await db.entries.get('collision-entry')
           return e && e.text === 'what I wrote'
         })()`,
        5000,
      )
      check('restoring puts the original text back', restored.ok)

      const stamp = await browser.evaluate(`
        const { db } = await import('/src/lib/storage/db.ts')
        const e = await db.entries.get('collision-entry')
        return e.updated_at
      `)
      check(
        'and stamps it newer than the write it undid, so the next pull leaves it alone',
        stamp > '2026-08-07T11:00:00.000Z',
        `updated_at is ${stamp}`,
      )

      const queued = await browser.evaluate(`
        const { db } = await import('/src/lib/storage/db.ts')
        const rows = await db.outbox.toArray()
        return rows.filter((r) => r.recordId === 'collision-entry').length
      `)
      check('and queues the restore for the other devices', queued >= 1, `${queued} outbox rows`)
    }
  }

  // Leave nothing behind for the next run or for a human opening the dev app.
  await browser.evaluate(`
    const { db } = await import('/src/lib/storage/db.ts')
    await db.entries.delete('collision-entry')
    await db.outbox.clear()
    await db.history.clear()
    return 1
  `)
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\n  overwrite toast gate PASSED\n' : `\n  ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
