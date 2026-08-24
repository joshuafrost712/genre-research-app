/**
 * Test stand-in for the onboarding gate. Production code no longer mints a
 * starter project on first run (ensureActiveContext resolves null until the
 * gate creates or joins one), so suites that start from a cleared DB seed a
 * scoped project here first — the same call the gate's "Start a new project"
 * path makes.
 *
 * Seeds only when the DB holds no project at all, and never touches the
 * active-project pointer otherwise, so tests that deliberately switch projects
 * (e.g. teamScoping's second team) keep their own state.
 */
import { db } from '../../src/lib/storage/db'
import {
  createScopedProject,
  ensureActiveContext,
  type ActiveContext,
} from '../../src/lib/storage/appState'

export async function testContext(): Promise<ActiveContext> {
  if ((await db.projects.count()) === 0) {
    await createScopedProject('Test culture', 'Test language', 'Test culture genres in Test language')
  }
  const ctx = await ensureActiveContext()
  if (!ctx) throw new Error('testContext: no active context even after seeding a project')
  return ctx
}
