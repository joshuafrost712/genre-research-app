import { describe, expect, it } from 'vitest'
import { renderBatchMarkdown } from '../src/devfeedback/render'
import type { FeedbackComment } from '../src/devfeedback/db'

/** Minimal comment factory: render only reads a handful of fields. */
function comment(p: Partial<FeedbackComment>): FeedbackComment {
  return {
    id: Math.random().toString(36).slice(2),
    route: '/macro',
    selectionText: '',
    locationLabel: 'Feelings (emotions)',
    comment: 'Some feedback.',
    importance: 'medium',
    status: 'open',
    createdAt: '2026-07-24T10:00:00.000Z',
    updatedAt: '2026-07-24T10:00:00.000Z',
    ...p,
  }
}

describe('renderBatchMarkdown attribution (beta mode)', () => {
  it('lists distinct submitters and stamps each attributed comment', () => {
    const md = renderBatchMarkdown(
      [
        comment({ comment: 'a', authorEmail: 'kate@example.com', authorName: 'Katie' }),
        comment({ comment: 'b', authorEmail: 'kate@example.com', authorName: 'Katie' }),
        comment({ comment: 'c', authorEmail: 'sam@example.com' }),
      ],
      '2026-07-24T10:00:00.000Z',
    )
    expect(md).toContain('**Submitted by:** Katie <kate@example.com>, sam@example.com')
    expect(md).toContain('- **By:** Katie <kate@example.com>')
    expect(md).toContain('- **By:** sam@example.com')
  })

  it('emits a stable node anchor when present', () => {
    const md = renderBatchMarkdown(
      [comment({ nodeId: 's2b.emotions', field: 'label' })],
      '2026-07-24T10:00:00.000Z',
    )
    expect(md).toContain('- **Node:** `s2b.emotions` · label')
  })

  it('omits attribution for anonymous (dev) feedback and bumps schema to v3', () => {
    const md = renderBatchMarkdown([comment({})], '2026-07-24T10:00:00.000Z')
    expect(md).not.toContain('Submitted by')
    expect(md).not.toContain('- **By:**')
    expect(md).toContain('"schema": "genre.feedback-batch/v3"')
  })
})
