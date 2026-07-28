/**
 * Point the translation proxy at Google Cloud Translation.
 *
 *   npm run translate:google                       # full setup
 *   npm run translate:google -- --no-glossary
 *   npm run translate:google -- --glossary-only    # refresh terminology only
 *
 * There are two Google paths and this script prefers the better one:
 *
 *   v2 (Basic)    a plain API key, five minutes to set up, NO glossary. Set
 *                 GOOGLE_TRANSLATE_API_KEY as a Supabase secret by hand and you are
 *                 done; the function uses it automatically when no service account
 *                 is present.
 *   v3 (Advanced) a service account, and the only version that can honour a
 *                 glossary. This script sets that up: bucket, glossary CSV built
 *                 from src/content/glossary/id.json, glossary resource, secrets.
 *
 * WHAT YOU HAVE TO DO FIRST, in the Cloud console, because none of it can be done
 * with a credential that does not exist yet:
 *
 *   1. Create (or pick) a project, with billing enabled — the always-free 500K
 *      characters/month still requires a billing account on the project.
 *   2. Enable "Cloud Translation API" and "Cloud Storage API".
 *   3. Create a service account, grant it "Cloud Translation API Editor" and
 *      "Storage Admin", create a JSON key, and save it to:
 *          ~/.claude/secrets/google-translate.json     (chmod 600)
 *
 * Everything after that is this script. No gcloud CLI needed; it talks REST and
 * signs its own tokens with node:crypto.
 *
 * Nothing here prints a credential. The service-account JSON is passed to
 * `supabase secrets set` through an env var rather than a command line, so the key
 * never lands in shell history or the process list.
 */
import { createSign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  bidirectionalTerms,
  buildGoogleGlossaryCsv,
  protectedTerms,
} from '../src/lib/translate/glossaryExport'

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const SA_PATH = process.env.GOOGLE_SA_PATH ?? join(homedir(), '.claude/secrets/google-translate.json')
const LOCATION = process.env.GOOGLE_LOCATION ?? 'us-central1'
const GLOSSARY_ID = process.env.GOOGLE_GLOSSARY ?? 'genre-research-en-id'
const args = new Set(process.argv.slice(2))

function die(message, ...extra) {
  console.error(`ERROR: ${message}`)
  for (const line of extra) console.error(`  ${line}`)
  process.exit(1)
}

function step(message) {
  console.log(`==> ${message}`)
}

// --- credentials --------------------------------------------------------------

if (!existsSync(SA_PATH)) {
  die(
    `no service-account key at ${SA_PATH}`,
    'Create one in the Cloud console (see the header of this script), or set',
    'GOOGLE_SA_PATH to point at it. For the quick v2 path instead, set the',
    'GOOGLE_TRANSLATE_API_KEY Supabase secret by hand and skip this script.',
  )
}

const saRaw = readFileSync(SA_PATH, 'utf8')
let sa
try {
  sa = JSON.parse(saRaw)
} catch {
  die(`${SA_PATH} is not valid JSON`)
}
if (!sa.client_email || !sa.private_key || !sa.project_id) {
  die(`${SA_PATH} is missing client_email, private_key, or project_id`)
}
const PROJECT = process.env.GOOGLE_PROJECT_ID ?? sa.project_id
const BUCKET = process.env.GOOGLE_BUCKET ?? `${PROJECT}-genre-glossary`

// --- access token -------------------------------------------------------------

/** Base64url, as JWT requires. */
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function accessToken(scope) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const assertion = `${header}.${claims}.${b64url(signer.sign(sa.private_key.replace(/\\n/g, '\n')))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    die(
      `token exchange failed (${res.status})`,
      (await res.text()).slice(0, 300),
      'Usually: the Cloud Translation API is not enabled, or the key was revoked.',
    )
  }
  return (await res.json()).access_token
}

async function api(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Google returns HTML for some auth failures; keep it for the error message.
    body = { raw: text }
  }
  return { ok: res.ok, status: res.status, body }
}

// --- glossary -----------------------------------------------------------------

/**
 * Glossary resources are IMMUTABLE: there is no update, so refreshing terminology
 * means delete then create. Deletion is asynchronous, hence the wait — creating
 * over a half-deleted resource fails with a name conflict that reads like a bug.
 */
async function replaceGlossary(token, csv) {
  step(`Ensuring bucket gs://${BUCKET}`)
  const mk = await api(
    token,
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(PROJECT)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: BUCKET, location: 'US', storageClass: 'STANDARD' }),
    },
  )
  if (!mk.ok && mk.status !== 409) {
    die(`could not create bucket (${mk.status})`, JSON.stringify(mk.body).slice(0, 300))
  }
  console.log(mk.status === 409 ? '    already exists' : '    created')

  step('Uploading the glossary CSV')
  const up = await api(
    token,
    `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=glossary-en-id.csv`,
    { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv },
  )
  if (!up.ok) die(`upload failed (${up.status})`, JSON.stringify(up.body).slice(0, 300))
  console.log(`    gs://${BUCKET}/glossary-en-id.csv`)

  const parent = `projects/${PROJECT}/locations/${LOCATION}`
  const name = `${parent}/glossaries/${GLOSSARY_ID}`

  const existing = await api(token, `https://translate.googleapis.com/v3/${name}`)
  if (existing.ok) {
    step('Deleting the previous glossary (they are immutable)')
    const del = await api(token, `https://translate.googleapis.com/v3/${name}`, {
      method: 'DELETE',
    })
    if (!del.ok) die(`delete failed (${del.status})`, JSON.stringify(del.body).slice(0, 300))
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const gone = await api(token, `https://translate.googleapis.com/v3/${name}`)
      if (!gone.ok) break
      if (i === 29) die('the previous glossary did not finish deleting')
    }
    console.log('    deleted')
  }

  step('Creating the glossary')
  const create = await api(token, `https://translate.googleapis.com/v3/${parent}/glossaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      // An equivalent term set, so ONE resource serves en->id and id->en. A
      // unidirectional glossary would need a second resource kept in step.
      languageCodesSet: { languageCodes: ['en', 'id'] },
      inputConfig: { gcsSource: { inputUri: `gs://${BUCKET}/glossary-en-id.csv` } },
    }),
  })
  if (!create.ok) {
    die(`glossary creation failed (${create.status})`, JSON.stringify(create.body).slice(0, 400))
  }

  // Creation returns a long-running operation; the glossary is unusable until it
  // completes, and a translate call that names an incomplete glossary just fails.
  const op = create.body?.name
  step('Waiting for the glossary to build')
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const status = await api(token, `https://translate.googleapis.com/v3/${op}`)
    if (status.body?.error) {
      die('glossary build failed', JSON.stringify(status.body.error).slice(0, 400))
    }
    if (status.body?.done) {
      console.log(`    ready: ${name}`)
      return name
    }
  }
  die('glossary build did not finish in two minutes')
}

// --- Supabase -----------------------------------------------------------------

function supabaseEnv() {
  const secrets = join(homedir(), '.claude/secrets/supabase.env')
  if (!process.env.SUPABASE_ACCESS_TOKEN && existsSync(secrets)) {
    for (const line of readFileSync(secrets, 'utf8').split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim())
      if (m) process.env[m[1]] = m[2]
    }
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN) die('SUPABASE_ACCESS_TOKEN is not set')

  const env = readFileSync(join(APP_DIR, '.env'), 'utf8')
  const url = /^VITE_SUPABASE_URL=(.*)$/m.exec(env)?.[1] ?? ''
  const ref = /https?:\/\/([^.]+)\./.exec(url)?.[1]
  if (!ref) die('could not read the Supabase project ref from .env (VITE_SUPABASE_URL)')
  return ref
}

/**
 * `supabase secrets set` takes NAME=VALUE on the command line, which would put the
 * private key in shell history and the process list. A dotenv file passed with
 * --env-file keeps it out of both; it is written to a temp path and overwritten
 * with zeros before being removed.
 */
function setSecrets(ref, pairs) {
  const file = join(tmpdir(), `genre-translate-secrets-${process.pid}.env`)
  const body = Object.entries(pairs)
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join('\n')
  writeFileSync(file, `${body}\n`, { mode: 0o600 })
  try {
    execFileSync('supabase', ['secrets', 'set', '--env-file', file, '--project-ref', ref], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  } finally {
    writeFileSync(file, '0'.repeat(body.length), { mode: 0o600 })
    rmSync(file, { force: true })
  }
}

// --- run ----------------------------------------------------------------------

const csv = buildGoogleGlossaryCsv()
console.log(
  `Glossary: ${bidirectionalTerms().length} term pairs + ${protectedTerms().length} protected terms`,
)

const token = await accessToken(
  'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/cloud-translation',
)

let glossaryName = null
if (!args.has('--no-glossary')) {
  glossaryName = await replaceGlossary(token, csv)
} else {
  console.log('==> Skipping the glossary (--no-glossary)')
}

if (args.has('--glossary-only')) {
  console.log('\nGlossary done. Secrets and deploy skipped (--glossary-only).')
  process.exit(0)
}

const ref = supabaseEnv()

step('Setting Supabase secrets')
setSecrets(ref, {
  TRANSLATE_ENGINE: 'google',
  GOOGLE_SERVICE_ACCOUNT_JSON: saRaw,
  GOOGLE_PROJECT_ID: PROJECT,
  GOOGLE_LOCATION: LOCATION,
  ...(glossaryName ? { GOOGLE_GLOSSARY: glossaryName } : {}),
})
console.log('    set (values not echoed)')

step('Deploying the function')
execFileSync(
  'supabase',
  ['functions', 'deploy', 'translate', '--project-ref', ref, '--no-verify-jwt'],
  { cwd: APP_DIR, stdio: 'inherit' },
)

// An unauthenticated POST is the free health check: 503 means the engine has no
// credentials, 401 means it has them and is now asking who you are. Costs nothing,
// because the readiness check runs before any translation call.
const fnUrl = `https://${ref}.supabase.co/functions/v1/translate`
step('Verifying (unauthenticated probe, no translation, no spend)')
let code = 0
for (let i = 0; i < 5; i++) {
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'probe', targetLocale: 'id', sourceLocale: 'en' }),
  })
  code = res.status
  if (code !== 503) break
  console.log(`    still 503: ${JSON.stringify(await res.json())}`)
  await new Promise((r) => setTimeout(r, 3000)) // a warm isolate can hold the old env
}

if (code === 401) {
  console.log('OK: Google is live and the function is asking callers to sign in.')
} else {
  die(`unexpected status ${code} from ${fnUrl}`, 'Check the function logs.')
}

console.log(`
Engine is now Google${glossaryName ? ' with the glossary attached' : ' (no glossary)'}.

  * Switch back to Haiku any time with:
      supabase secrets set TRANSLATE_ENGINE=anthropic --project-ref ${ref}
    No redeploy or site rebuild needed either way.
  * Testers reach translation at <app-url>?beta=1 and must sign in.
  * Re-run with --glossary-only after editing src/content/glossary/id.json.

Function: ${fnUrl}
Logs:     https://supabase.com/dashboard/project/${ref}/functions/translate/logs
`)
