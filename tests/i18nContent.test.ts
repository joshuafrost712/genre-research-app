import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuideNode } from '../src/schema/types'

// A fixture catalogue stands in for the shipped Indonesian one, so these tests
// assert the FALLBACK MACHINERY rather than the current state of the translation
// work. Deliberately partial: some keys present, some absent, one blank, so every
// branch of "is this string translated?" is exercised.
vi.mock('../src/content/translations/id.json', () => ({
  default: {
    $meta: { locale: 'id', note: 'documentation, not a translation key' },
    'demo.label': 'Judul',
    'demo.guidance': 'Panduan',
    'demo.help': '   ', // blank: must count as MISSING, not as an empty translation
    'demo.option.a': 'Pilihan A',
    'demo.column.c1.label': 'Kolom Satu',
    'demo.column.c1.option.x': 'Opsi X',
    'demo.row.r1': 'Baris Satu',
    'child.label': 'Anak',
  },
}))

const { localizedField, localizedNode, translate, catalogueSize, clearLocalizedCache } =
  await import('../src/lib/i18n/content')
const { nodeKey, optionKey, columnKey, columnOptionKey, rowKey } = await import(
  '../src/lib/i18n/keys'
)

const node: GuideNode = {
  id: 'demo',
  type: 'long_text',
  label: 'Title',
  guidance: 'Guidance',
  footnote: 'A footnote',
  help: 'Help text',
  layer: 'genre',
  minDepth: 'standard',
  optional: false,
  options: [
    { id: 'a', label: 'Option A' },
    { id: 'b', label: 'Option B' },
  ],
  columns: [
    {
      id: 'c1',
      label: 'Column One',
      cellType: 'single_select',
      help: 'Column help',
      options: [
        { id: 'x', label: 'Opt X' },
        { id: 'y', label: 'Opt Y' },
      ],
    },
  ],
  rows: [
    { id: 'r1', label: 'Row One' },
    { id: 'r2', label: 'Row Two' },
  ],
  children: [{ id: 'child', type: 'short_text', label: 'Child' }],
}

beforeEach(() => clearLocalizedCache())

describe('translation key scheme', () => {
  it('builds keys from stable ids, not from text', () => {
    expect(nodeKey('demo', 'label')).toBe('demo.label')
    expect(optionKey('demo', 'a')).toBe('demo.option.a')
    expect(columnKey('demo', 'c1', 'help')).toBe('demo.column.c1.help')
    expect(columnOptionKey('demo', 'c1', 'x')).toBe('demo.column.c1.option.x')
    expect(rowKey('demo', 'r1')).toBe('demo.row.r1')
  })
})

describe('translate', () => {
  it('returns a hit for a present key', () => {
    expect(translate('id', 'demo.label')).toBe('Judul')
  })

  it('treats a missing key as untranslated', () => {
    expect(translate('id', 'demo.footnote')).toBeUndefined()
  })

  it('treats a whitespace-only value as untranslated', () => {
    // Guards the likeliest review slip: a key left blank must fall back to
    // English, not blank out the UI.
    expect(translate('id', 'demo.help')).toBeUndefined()
  })

  it('never consults a catalogue for the source language', () => {
    expect(translate('en', 'demo.label')).toBeUndefined()
  })

  it('excludes $meta from the catalogue', () => {
    expect(translate('id', '$meta')).toBeUndefined()
    expect(catalogueSize('id')).toBe(8) // 8 real keys; $meta is documentation
  })
})

describe('localizedField', () => {
  it('prefers the translation', () => {
    expect(localizedField('demo', 'label', 'id', 'Title')).toBe('Judul')
  })

  it('falls back to English when untranslated', () => {
    expect(localizedField('demo', 'footnote', 'id', 'A footnote')).toBe('A footnote')
  })

  it('keeps an absent optional field absent', () => {
    // Must not turn undefined into '', which would render an empty help toggle.
    expect(localizedField('demo', 'example', 'id', undefined)).toBeUndefined()
  })
})

describe('localizedNode', () => {
  it('returns the identical object for the source locale', () => {
    expect(localizedNode(node, 'en')).toBe(node)
  })

  it('translates node prose and falls back per field', () => {
    const out = localizedNode(node, 'id')
    expect(out.label).toBe('Judul')
    expect(out.guidance).toBe('Panduan')
    expect(out.footnote).toBe('A footnote') // untranslated
    expect(out.help).toBe('Help text') // blank in catalogue, so English
  })

  it('translates options, columns, column options, and rows', () => {
    const out = localizedNode(node, 'id')
    expect(out.options?.map((o) => o.label)).toEqual(['Pilihan A', 'Option B'])
    expect(out.columns?.[0].label).toBe('Kolom Satu')
    expect(out.columns?.[0].help).toBe('Column help') // untranslated
    expect(out.columns?.[0].options?.map((o) => o.label)).toEqual(['Opsi X', 'Opt Y'])
    expect(out.rows?.map((r) => r.label)).toEqual(['Baris Satu', 'Row Two'])
  })

  it('recurses into children', () => {
    expect(localizedNode(node, 'id').children?.[0].label).toBe('Anak')
  })

  it('preserves every structural field, so behaviour cannot diverge by language', () => {
    const out = localizedNode(node, 'id')
    expect(out.id).toBe('demo')
    expect(out.type).toBe('long_text')
    expect(out.layer).toBe('genre')
    expect(out.minDepth).toBe('standard')
    expect(out.optional).toBe(false)
    // Ids are the join key for stored answers; translating one would orphan data.
    expect(out.options?.map((o) => o.id)).toEqual(['a', 'b'])
    expect(out.columns?.[0].id).toBe('c1')
    expect(out.columns?.[0].cellType).toBe('single_select')
    expect(out.rows?.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(out.children?.[0].id).toBe('child')
  })

  it('does not mutate the source node', () => {
    localizedNode(node, 'id')
    expect(node.label).toBe('Title')
    expect(node.options?.[0].label).toBe('Option A')
  })

  it('memoises per node and locale', () => {
    expect(localizedNode(node, 'id')).toBe(localizedNode(node, 'id'))
  })
})
