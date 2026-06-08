/**
 * Worksheet schema types.
 *
 * The worksheet is DATA, not code: Katie's sections, subsections, prompts,
 * tables, and guidance live in `content/guide-content.json` and the app is a
 * renderer over that tree. Answers bind to a stable `id`, never a label, so
 * Katie can re-word a prompt without orphaning stored answers.
 *
 * See the canonical plan ("Local Genres Research App - MVP Plan") in the vault.
 */

/** Anti-overwhelm depth, cumulative by rank: quick < standard < comprehensive. */
export type DepthMode = 'quick' | 'standard' | 'comprehensive'

export const DEPTH_RANK: Record<DepthMode, number> = {
  quick: 0,
  standard: 1,
  comprehensive: 2,
}

/**
 * Which entity an answer to this node attaches to. The linchpin field:
 * unifies the brief's "analysis layer" with the earlier plan's "scope" and
 * decides whether an Entry lands on a Genre, a FocusText, or a TranslationWorksheet.
 *  - 'genre':     reusable genre analysis (Sections 1B, 2, 3)
 *  - 'focusText': describes the psalm (Section 0 purpose, 1A, 1C)
 *  - 'synthesis': the psalm-and-genre pairing (Section 0 translation notes)
 */
export type Layer = 'genre' | 'focusText' | 'synthesis'

export type BlockType =
  | 'prose' // read-only guidance, no answer
  | 'short_text'
  | 'long_text' // dictation-enabled
  | 'single_select'
  | 'multi_select'
  | 'three_point_scale' // weak / neutral / strong (1B vitality)
  | 'repeatable_list'
  | 'repeatable_row_table' // user-added rows, predefined columns
  | 'fixed_grid' // predefined rows x columns; cells addressed rowId__colId
  | 'group' // container; nests children

export type CellType =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'

export type XRefRelation = 'feeds' | 'summarizes' | 'derivedFrom' | 'seeAlso'

export interface XRef {
  to: string // target node id
  relation: XRefRelation
  label?: string
}

export interface SelectOption {
  id: string
  label: string
}

export interface ColumnDef {
  id: string
  label: string
  cellType: CellType
  minDepth?: DepthMode // columns can appear only at greater depth
  options?: SelectOption[]
}

export interface RowDef {
  id: string
  label: string
}

export interface GuideNode {
  id: string
  type: BlockType
  label: string

  layer?: Layer
  guidance?: string // contextual helper; Katie still to author most of these
  footnote?: string
  minDepth?: DepthMode // node visible when mode rank >= this rank (default quick)
  optional?: boolean // defaults true

  // priority: honors "mark your top 1 to 2" in the 3A-3F feature tables
  priorityEligible?: boolean
  priorityMax?: number

  // select inputs
  options?: SelectOption[]

  // table / grid inputs
  columns?: ColumnDef[]
  rows?: RowDef[] // static rows for fixed_grid
  rowSource?: string // node id whose list supplies dynamic grid rows (e.g. emotions)

  xref?: XRef[]
  children?: GuideNode[]
}

export interface GuideContent {
  version: string
  title: string
  sections: GuideNode[]
}

/** True if something tagged at `minDepth` is visible at the current mode. */
export function depthVisible(minDepth: DepthMode | undefined, mode: DepthMode): boolean {
  return DEPTH_RANK[minDepth ?? 'quick'] <= DEPTH_RANK[mode]
}

/** True if a node is visible at the given depth mode. */
export function visibleAtDepth(node: GuideNode, mode: DepthMode): boolean {
  return depthVisible(node.minDepth, mode)
}
