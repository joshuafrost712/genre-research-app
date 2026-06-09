// Renders the GitHub routing workspace (the routing/ folder) and defines the
// note/result file shapes exchanged through the repo or the copy/paste path.
// Runtime-agnostic; consumed by src/routing/.
//
//   app    -> routing/inbox/<id>.json   (a captured note + context, self-contained)
//   you    -> open Claude on the repo, "route the inbox per ROUTING.md"
//   Claude -> routing/outbox/<id>.json  (placements matching reference/schema.json)
//   app    -> imports routing/outbox/*.json as needs_review entries to confirm

import { ROUTING_RULES, PLACEMENTS_SCHEMA, type RoutedPlacement } from './contract'

export const NOTE_SCHEMA_ID = 'genre.note/v1'
export const PLACEMENTS_FILE_SCHEMA_ID = 'genre.placements/v1'

/** A routable worksheet node, inlined so an inbox file is self-contained. */
export interface RoutableNodeRef {
  id: string
  section: string
  subsection: string
  label: string
  type: string
}

/** A self-contained captured note written to routing/inbox/<id>.json. */
export interface NoteFile {
  schema: typeof NOTE_SCHEMA_ID
  note_id: string
  source_text: string
  source_language: string | null
  context: { focus_text: string; genre: string }
  routable_nodes: RoutableNodeRef[]
  created_at: string
}

/** The file Claude writes to routing/outbox/<id>.json. */
export interface PlacementsFile {
  schema: typeof PLACEMENTS_FILE_SCHEMA_ID
  note_id: string
  routed_at: string
  placements: RoutedPlacement[]
}

export function buildNoteFile(args: {
  note_id: string
  source_text: string
  source_language: string | null
  focus_text: string
  genre: string
  routable_nodes: RoutableNodeRef[]
  created_at: string
}): NoteFile {
  return {
    schema: NOTE_SCHEMA_ID,
    note_id: args.note_id,
    source_text: args.source_text,
    source_language: args.source_language,
    context: { focus_text: args.focus_text, genre: args.genre },
    routable_nodes: args.routable_nodes,
    created_at: args.created_at,
  }
}

const INBOX = 'routing/inbox'
const OUTBOX = 'routing/outbox'
export const inboxPath = (id: string) => `${INBOX}/${id}.json`
export const outboxPath = (id: string) => `${OUTBOX}/${id}.json`

/** routing/ROUTING.md — the runbook Claude (via Max) follows on the repo. */
export function renderRoutingDoc(): string {
  return `# Routing runbook (for Claude)

This repo is the routing substrate for the Local Genres Research app. **No metered
API is used** — routing is done by Claude operating directly on this repo (via a
Claude Max subscription) or through a copy/paste path. You are that Claude.

## Your job

For every file in \`inbox/\` that does **not** already have a matching file in
\`outbox/\` (same filename), read the captured note and propose where it belongs.

Each \`inbox/<id>.json\` is self-contained: it inlines the active focus text and
genre and the list of routable worksheet nodes (id, section, subsection, label,
type), so you do not need any other file. \`reference/schema.json\` is the exact
output shape.

## The routing contract

${ROUTING_RULES}

## Output

For each \`inbox/<id>.json\` you route, write \`outbox/<id>.json\` (same \`<id>\`) as:

\`\`\`json
{
  "schema": "${PLACEMENTS_FILE_SCHEMA_ID}",
  "note_id": "<id>",
  "routed_at": "<ISO 8601 timestamp>",
  "placements": [ /* objects matching reference/schema.json */ ]
}
\`\`\`

Do not modify anything in \`inbox/\`. Commit the new \`outbox/\` files. The app then
imports them as needs-review entries for the team to confirm. An empty
\`placements\` array is valid when a note contains nothing routable.
`
}

export function renderSchemaJson(): string {
  return JSON.stringify(PLACEMENTS_SCHEMA, null, 2) + '\n'
}

export function renderNodesJson(nodes: RoutableNodeRef[]): string {
  return JSON.stringify(nodes, null, 2) + '\n'
}
