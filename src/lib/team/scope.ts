/**
 * A project's culture/language scope, and the one place its composed name
 * ("{culture} genres in {language}") is rendered.
 *
 * Unlike a team's display name (rename.ts), the scope has no server-side
 * mirror: it lives on the replicated `projects` row and reaches every member
 * and device through ordinary sync. So `setTeamScope` is a local write that
 * works offline — kept as the UI-facing seam so a future `shared_projects`
 * mirror (deferred until something server-side can actually read it) slots in
 * behind it without touching callers.
 */
import { cleanScopeField, setProjectScope } from '../storage/appState'
import type { UiKey, UiVars } from '../i18n/strings'

/** The `t` shape components get from useLocale(). */
type Translate = (key: UiKey, vars?: UiVars) => string

/** The default project name for a scope, localized: "Common USA genres in American English". */
export function composeProjectName(t: Translate, culture: string, language: string): string {
  return t('onboard.nameTemplate', {
    culture: cleanScopeField(culture),
    language: cleanScopeField(language),
  })
}

export async function setTeamScope(
  projectId: string,
  culture: string,
  language: string,
): Promise<void> {
  await setProjectScope(projectId, culture, language)
}
