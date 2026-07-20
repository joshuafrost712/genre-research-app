import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './storage/db'
import { uid } from './util'
import type { GuideNode, SelectOption } from '../schema/types'

/**
 * User-added options for select inputs that declare `allowCustomOptions`
 * (feedback 2026-07-20 evening #7: "Other" on the 1b purpose families should
 * let people add their own purpose type).
 *
 * Custom options are project-wide vocabulary (not per-genre data), so they
 * live in the meta table rather than as entries. Note: meta is outside the
 * export/sync path for now — see spec 10's deferred list.
 */
const metaKey = (projectId: string, nodeId: string) => `customOptions:${projectId}:${nodeId}`

function parse(value: string | undefined): SelectOption[] {
  if (!value) return []
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr.filter((o) => o && o.id && o.label) : []
  } catch {
    return []
  }
}

export async function getCustomOptions(
  projectId: string,
  nodeId: string,
): Promise<SelectOption[]> {
  const row = await db.meta.get(metaKey(projectId, nodeId))
  return parse(row?.value)
}

/**
 * Adds a custom option, deduping case-insensitively against both the node's
 * built-in options and the existing custom ones. Returns the (new or existing)
 * option, or null for a blank label.
 */
export async function addCustomOption(
  projectId: string,
  node: GuideNode,
  label: string,
): Promise<SelectOption | null> {
  const name = label.trim()
  if (!name) return null
  const lower = name.toLowerCase()
  const builtIn = (node.options ?? []).find((o) => o.label.toLowerCase() === lower)
  if (builtIn) return builtIn
  const existing = await getCustomOptions(projectId, node.id)
  const dup = existing.find((o) => o.label.toLowerCase() === lower)
  if (dup) return dup
  const opt: SelectOption = { id: `c_${uid()}`, label: name }
  await db.meta.put({
    key: metaKey(projectId, node.id),
    value: JSON.stringify([...existing, opt]),
  })
  return opt
}

/** Live view of a node's custom options; empty array while loading. */
export function useCustomOptions(projectId: string, nodeId: string): SelectOption[] {
  const row = useLiveQuery(() => db.meta.get(metaKey(projectId, nodeId)), [projectId, nodeId])
  return parse(row?.value)
}

/** The node's built-in options plus the project's custom ones, in that order. */
export function mergeOptions(node: GuideNode, custom: SelectOption[]): SelectOption[] {
  const base = node.options ?? []
  const ids = new Set(base.map((o) => o.id))
  return [...base, ...custom.filter((o) => !ids.has(o.id))]
}
