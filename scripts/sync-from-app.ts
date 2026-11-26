/**
 * Copies the code the PWA shares with the desktop app from a checkout of nexa-app into pwa/src, byte for
 * byte, so both stay the same: the themes, the chat model, Remote Control, envelope, members and pairing
 * code, the client of the server link and of Remote Control, and whatever those import. protocol.ts and
 * auth.ts come from this repo's src instead, since they are the originals the app copies.
 *
 *   node scripts/sync-from-app.ts           copy (nexa-app next to this repo, or NEXA_APP_DIR)
 *   node scripts/sync-from-app.ts --check   only compare; exit code 1 if anything differs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(process.env.NEXA_APP_DIR ?? join(root, '..', 'nexa-app'))
const check = process.argv.includes('--check')

/** Entry points in the app's src/shared; everything they import (relatively) comes along. */
const SHARED_ENTRIES = [
  'chat.ts',
  'inbox.ts',
  'remote.ts',
  'nexa-server/envelope.ts',
  'nexa-server/members.ts',
  'nexa-server/pairing-code.ts',
  'themes/builtin.ts',
  'themes/checks.ts',
  'themes/colors.ts',
  'themes/file.ts',
  'themes/types.ts',
]
/**
 * Files of the app outside src/shared, with where they go in pwa/src. What they import from `@shared/`
 * comes along; their relative imports the PWA provides itself, in the same places (client/lib,
 * client/server-link/link-store.ts).
 */
const EXTRA: Record<string, string> = {
  'src/renderer/src/lib/code-colors.ts': 'lib/code-colors.ts',
  'src/main/server-link/connection.ts': 'client/server-link/connection.ts',
  'src/main/server-link/device-channel.ts': 'client/server-link/device-channel.ts',
  'src/main/server-link/membership.ts': 'client/server-link/membership.ts',
  'src/main/remote/remote-client.ts': 'client/remote/remote-client.ts',
}
/** Copies in the app whose originals live here. */
const ORIGINALS: Record<string, string> = {
  'nexa-server/protocol.ts': 'src/protocol.ts',
  'nexa-server/auth.ts': 'src/auth.ts',
}

const sharedSource = join(app, 'src', 'shared')
const sharedTarget = join(root, 'pwa', 'src', 'shared')
if (!existsSync(sharedSource)) {
  console.error(`nexa-app nicht gefunden unter ${app}. NEXA_APP_DIR setzen.`)
  process.exit(2)
}

const IMPORT = /(?:^|\n)\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]/g
const withTs = (path: string) => (path.endsWith('.ts') ? path : `${path}.ts`)

/** Every file to write: path in pwa/src → its content. */
const files = new Map<string, string>()
const queue = [...SHARED_ENTRIES]
for (const [from, to] of Object.entries(EXTRA)) {
  const content = readFileSync(join(app, from), 'utf8')
  files.set(to, content)
  for (const match of content.matchAll(IMPORT)) {
    if (match[1]!.startsWith('@shared/')) queue.push(withTs(match[1]!.slice('@shared/'.length)))
  }
}
while (queue.length > 0) {
  const file = queue.shift()!
  const target = posix.join('shared', file)
  if (files.has(target)) continue
  const source = ORIGINALS[file] ? join(root, ORIGINALS[file]) : join(sharedSource, file)
  const content = readFileSync(source, 'utf8')
  files.set(target, content)
  for (const match of content.matchAll(IMPORT)) {
    const specifier = match[1]!
    if (!specifier.startsWith('.')) continue
    const next = withTs(posix.normalize(posix.join(posix.dirname(file), specifier)))
    if (next.startsWith('..')) throw new Error(`${file} importiert ${specifier} außerhalb von src/shared.`)
    queue.push(next)
  }
}

let differing = 0
for (const [path, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  const target = join(root, 'pwa', 'src', path)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  if (current === content) continue
  differing++
  console.log(`${current === null ? 'neu     ' : 'geändert'} pwa/src/${path}`)
  if (!check) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

// Files the app no longer needs would linger and drift; only shared/ is ours to clean.
const wanted = new Set([...files.keys()].filter((path) => path.startsWith('shared/')))
for (const file of walk(sharedTarget)) {
  const path = posix.join('shared', relative(sharedTarget, file).split('\\').join('/'))
  if (wanted.has(path) || path === 'shared/README.md') continue
  differing++
  console.log(`übrig    pwa/src/${path}`)
  if (!check) rmSync(file)
}

if (differing === 0) console.log(`Alle ${files.size} Dateien gleich wie in nexa-app.`)
else if (check) {
  console.log(`${differing} Datei(en) weichen ab. Abgleichen mit: node scripts/sync-from-app.ts`)
  process.exitCode = 1
} else console.log(`${differing} Datei(en) abgeglichen, ${files.size} insgesamt.`)

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  )
}
