/**
 * Writes the Supabase Edge Function's copy of the translation contract.
 *
 *   npm run i18n:contract          # write it
 *   npm run i18n:contract -- check # exit non-zero if it is out of date
 *
 * The Edge Function runs on Deno and is bundled from its own directory, so it
 * cannot import src/lib/translate/prompt.ts. Rather than authoring the prompt
 * twice, it is authored once in src/ and its rendered form committed here. The
 * rendering itself lives in src/lib/translate/contract.ts so a test can assert the
 * committed artifact is current.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONTRACT_PATH, renderContract } from '../src/lib/translate/contract'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(repo, CONTRACT_PATH)
const rendered = renderContract()

if (process.argv[2] === 'check') {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
  if (current !== rendered) {
    console.error(`${CONTRACT_PATH} is out of date. Run: npm run i18n:contract`)
    process.exit(1)
  }
  console.log('translation contract is up to date')
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, rendered, 'utf8')
  const locales = Object.keys(JSON.parse(rendered).systemPrompts as Record<string, string>)
  console.log(`wrote ${CONTRACT_PATH}`)
  console.log(`  locales: ${locales.join(', ') || '(none)'}`)
  console.log(`  bytes: ${rendered.length}`)
}
