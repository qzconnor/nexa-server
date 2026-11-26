/**
 * The web app at `/app` (`NEXA_PWA`): Vite's build output, read into memory once at start. Only files
 * found there exist, so no request path ever reaches the file system, and nothing changes under a
 * running server.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const PWA_PATH = '/app/'
/** Where `npm run build:pwa` writes the app: next to src, here and in the image. */
export const PWA_DIR = fileURLToPath(new URL('../dist/app/', import.meta.url))

interface PwaFile {
  body: Buffer
  gzip: Buffer | null
  type: string
  etag: string
  /** Vite puts a hash of the content into the names under assets/, so they never change. */
  immutable: boolean
}

export type PwaFiles = ReadonlyMap<string, PwaFile>

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|manifest\+json)|image\/svg)/

/** The app's files by their path below `/app/`, or null if it has not been built into `dir`. */
export function loadPwa(dir: string): PwaFiles | null {
  if (!existsSync(join(dir, 'index.html'))) return null
  const files = new Map<string, PwaFile>()
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath, entry.name)
    const path = relative(dir, full).split(sep).join('/')
    const body = readFileSync(full)
    const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
    // Compressed once here rather than per request; small files are not worth it.
    const gzip = COMPRESSIBLE.test(type) && body.length > 1024 ? gzipSync(body, { level: 9 }) : null
    files.set(path, {
      body,
      gzip: gzip && gzip.length < body.length ? gzip : null,
      type,
      etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
      immutable: path.startsWith('assets/'),
    })
  }
  return files
}

/**
 * Answers a GET or HEAD below `/app/`. False if there is no such file, for a 404. Paths without a file
 * extension are routes of the app and get index.html; a missing asset stays missing, so an outdated
 * chunk fails loudly instead of being parsed as HTML.
 */
export function servePwa(req: IncomingMessage, res: ServerResponse, files: PwaFiles, path: string): boolean {
  let name: string
  try {
    name = decodeURIComponent(path.slice(PWA_PATH.length))
  } catch {
    return false
  }
  const file = files.get(name) ?? (/\.[a-z0-9]+$/i.test(name) ? undefined : files.get('index.html'))
  if (!file) return false

  // The app holds the keys of a namespace, so it must run only its own code, from here, in no frame.
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(req))
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cache-Control', file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('ETag', file.etag)
  res.setHeader('Vary', 'Accept-Encoding')

  if (matchesEtag(req.headers['if-none-match'], file.etag)) {
    res.writeHead(304)
    res.end()
    return true
  }
  const gzip = file.gzip !== null && /\bgzip\b/i.test(req.headers['accept-encoding'] ?? '')
  const body = gzip ? file.gzip! : file.body
  res.writeHead(200, {
    'Content-Type': file.type,
    'Content-Length': body.length,
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  })
  res.end(req.method === 'HEAD' ? undefined : body)
  return true
}

function contentSecurityPolicy(req: IncomingMessage): string {
  // 'self' covers wss: of the same host in current browsers; older Safari only takes it spelled out.
  // Host comes from the client, so only a plain host name or address makes it into the header.
  const host = req.headers.host ?? ''
  const ws = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i.test(host) ? ` wss://${host}` : ''
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${ws}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  // Proxies that compress turn the tag weak (W/"…"); for a revalidation that is the same file.
  return header !== undefined && header.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)
}
