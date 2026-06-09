// Routing config. The routing repo (where notes are exchanged with Claude) is set
// at build time; the GitHub token is entered in-app and stored on-device only
// (never committed, never in env). Use a fine-grained PAT scoped to the one
// private routing repo (Contents: read & write). The manual copy/paste path needs
// none of this.

const TOKEN_KEY = 'genre.routing.github_token'

/** "owner/repo" of the private routing repo, e.g. "joshuafrost712/genre-routing". */
export function getRoutingRepo(): string | null {
  const v = import.meta.env.VITE_ROUTING_REPO as string | undefined
  return v && v.includes('/') ? v : null
}

export function getRoutingBranch(): string {
  return (import.meta.env.VITE_ROUTING_BRANCH as string | undefined) || 'main'
}

export function getRoutingToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setRoutingToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearRoutingToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Repo is set: the automated push/pull flow is available once a token is entered. */
export function isRoutingRepoConfigured(): boolean {
  return getRoutingRepo() !== null
}

/** Repo + token: the automated push/pull flow is available now. */
export function canPushPull(): boolean {
  return isRoutingRepoConfigured() && Boolean(getRoutingToken())
}
