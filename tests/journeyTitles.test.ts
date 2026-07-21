import { describe, expect, it } from 'vitest'
import {
  findNode,
  journey,
  splitStageTitle,
  workspaces,
} from '../src/lib/content/loader'

/**
 * Single-source-of-truth titles: every displayed stage/workspace title is
 * derived from a content node's `label` (a subsection, or a chrome node), so
 * editing a heading in place propagates to the sidebar, home chart, and print
 * chart. These tests pin the derivation and the chip splitter.
 */
describe('journey title derivation', () => {
  it('derives every single-subsection stage title from its content node', () => {
    for (const stage of journey()) {
      if (stage.subIds.length !== 1) continue
      const node = findNode(stage.subIds[0])
      expect(node, `node for stage ${stage.id}`).toBeDefined()
      expect(stage.titleNodeId).toBe(stage.subIds[0])
      expect(stage.title).toBe(node!.node.label)
    }
  })

  it('derives the multi-page and route-only stage titles from chrome nodes', () => {
    const byId = new Map(journey().map((s) => [s.id, s]))
    const describe = byId.get('describe')
    const summary = byId.get('summary')
    expect(describe?.titleNodeId).toBe('chrome.describe')
    expect(describe?.title).toBe(findNode('chrome.describe')!.node.label)
    expect(summary?.titleNodeId).toBe('chrome.summary')
    expect(summary?.title).toBe(findNode('chrome.summary')!.node.label)
  })

  it('finds chrome nodes through the shared node index', () => {
    expect(findNode('chrome.describe')).toBeDefined()
    expect(findNode('chrome.summary')).toBeDefined()
  })

  it('derives workspace titles from their top-level sections', () => {
    const [w1, w2] = workspaces()
    expect(w1.titleNodeId).toBe('s1')
    expect(w1.title).toBe(findNode('s1')!.node.label)
    expect(w2.titleNodeId).toBe('s0')
    expect(w2.title).toBe(findNode('s0')!.node.label)
  })
})

describe('splitStageTitle', () => {
  it('splits on a colon', () => {
    expect(splitStageTitle('1a: Find Local Genres')).toEqual(['1a', 'Find Local Genres'])
  })

  it('splits on the first separator when both are present', () => {
    expect(splitStageTitle('2c: The Big Picture — Compare & Decide')).toEqual([
      '2c',
      'The Big Picture — Compare & Decide',
    ])
  })

  it('splits on a legacy em-dash separator', () => {
    expect(splitStageTitle('1b–1e — Describe a Genre')).toEqual(['1b–1e', 'Describe a Genre'])
  })

  it('falls back to a bullet chip when no separator is present', () => {
    expect(splitStageTitle('No separator here')).toEqual(['•', 'No separator here'])
  })
})
