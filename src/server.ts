/** HTTP routes and the WebSocket upgrade; the relay does the rest. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import pkg from '../package.json' with { type: 'json' }
import { isPublicKey } from './auth.ts'
import { ConfigError, DEFAULT_VAPID_SUBJECT, type Config } from './config.ts'
import type { Logger } from './log.ts'
import {
  PROTOCOL_VERSION,
  parseJoinRequest,
  type HttpError,
  type JoinResponse,
  type ServerInfo,
} from './protocol.ts'
import { PWA_DIR, PWA_PATH, loadPwa, servePwa } from './pwa.ts'
import { Relay } from './relay.ts'
import { StoreError, type Store } from './store.ts'
import { generateVapidKeys, WebPush } from './web-push.ts'

export const VERSION: string = pkg.version

export interface ServerOptions {
  config: Pick<Config, 'host' | 'port' | 'maxMessageBytes' | 'rateLimit' | 'pwa'> & Partial<Pick<Config, 'vapidSubject'>>
  store: Store
  log: Logger
  /** The built web app, served when `config.pwa` is on; `dist/app` next to src unless given. */
  pwaDir?: string
  authTimeoutMs?: number
  heartbeatMs?: number
  /** Tests answer pushes here instead of a push service. */
  pushFetch?: typeof fetch
}

export interface RunningServer {
  url: string
  port: number
  relay: Relay
  close(): Promise<void>
}

const MAX_JOIN_BODY = 16 * 1024
const PRUNE_INVITES_MS = 60 * 60_000

class HttpFailure extends Error {
  readonly status: number
  readonly body: HttpError
  readonly headers: Record<string, string>
  constructor(status: number, error: HttpError['error'], message: string, headers: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.body = { error, message }
    this.headers = headers
  }
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { config, store, log } = options
  const pwaDir = options.pwaDir ?? PWA_DIR
  const pwa = config.pwa ? loadPwa(pwaDir) : null
  if (config.pwa && !pwa) {
    throw new ConfigError(`NEXA_PWA ist an, aber die Web-App fehlt in ${pwaDir}. Bauen mit: npm run build:pwa`)
  }
  // Push only with the web app: nothing else subscribes. The key pair stays, or every phone would have
  // to subscribe anew.
  const push = pwa
    ? new WebPush({
        keys: store.setting('vapid', generateVapidKeys),
        subject: config.vapidSubject ?? DEFAULT_VAPID_SUBJECT,
        fetch: options.pushFetch,
      })
    : null
  const relay = new Relay({
    store,
    log,
    maxMessageBytes: config.maxMessageBytes,
    rateLimit: config.rateLimit,
    maxBufferedBytes: config.maxMessageBytes * 16,
    authTimeoutMs: options.authTimeoutMs,
    heartbeatMs: options.heartbeatMs,
    push,
  })
  // No compression: bodies are ciphertext, and deflate per socket costs memory a relay should not spend.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes,
    perMessageDeflate: false,
    clientTracking: false,
  })

  const info: ServerInfo = { name: 'nexa-server', version: VERSION, protocol: PROTOCOL_VERSION, pwa: pwa !== null }
  if (push) {
    info.vapidKey = push.publicKey
    info.silentPush = true
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = pathOf(req)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    if (pwa && (path === '/app' || path.startsWith(PWA_PATH))) {
      // Same origin only: no CORS header, unlike the API below.
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpFailure(405, 'method-not-allowed', 'method not allowed', { Allow: 'GET, HEAD' })
      }
      if (path === '/app') {
        // Relative URLs in the app resolve against /app/, so the bare path would break them.
        const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
        res.writeHead(301, { Location: PWA_PATH + query, 'Content-Length': 0 })
        res.end()
        return
      }
      if (!servePwa(req, res, pwa, path)) throw new HttpFailure(404, 'not-found', 'not found')
      return
    }
    // Nothing here rides on cookies or other ambient credentials, so any origin may call it.
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }

    switch (path) {
      case '/':
      case '/v1/info':
        allow(req, 'GET')
        json(res, 200, info)
        return
      case '/health':
        allow(req, 'GET')
        try {
          store.ping()
          json(res, 200, { status: 'ok', connections: relay.connectionCount })
        } catch {
          json(res, 503, { status: 'error' })
        }
        return
      case '/v1/join':
        allow(req, 'POST')
        await join(req, res)
        return
      case '/v1/ws':
        throw new HttpFailure(426, 'bad-request', 'WebSocket upgrade required')
      default:
        throw new HttpFailure(404, 'not-found', 'not found')
    }
  }

  const join = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      throw new HttpFailure(415, 'unsupported-media-type', 'expected Content-Type: application/json')
    }
    let data: unknown
    try {
      data = JSON.parse(await readBody(req, MAX_JOIN_BODY))
    } catch (error) {
      if (error instanceof HttpFailure) throw error
      throw new HttpFailure(400, 'bad-request', 'not JSON')
    }
    const parsed = parseJoinRequest(data)
    if (!parsed.ok) throw new HttpFailure(400, 'bad-request', parsed.message)
    const { invite, ...instance } = parsed.value
    if (!(await isPublicKey(instance.signKey, 'sign'))) {
      throw new HttpFailure(400, 'bad-request', 'signKey: expected a raw P-256 public key')
    }
    if (!(await isPublicKey(instance.dhKey, 'dh'))) {
      throw new HttpFailure(400, 'bad-request', 'dhKey: expected a raw P-256 public key')
    }

    let record
    try {
      record = store.redeemInvite(invite, instance)
    } catch (error) {
      if (error instanceof StoreError && error.code === 'invite-invalid') {
        throw new HttpFailure(403, 'invite-invalid', 'the invite is unknown, used or expired')
      }
      if (error instanceof StoreError && error.code === 'namespace-full') {
        throw new HttpFailure(409, 'namespace-full', 'the namespace has the maximum number of instances')
      }
      throw error
    }
    log.info(`Neue Instanz ${record.id} („${record.name}“, ${record.role}) im Namespace „${record.namespace}“`)
    relay.notifyJoined(record)
    json(res, 201, { namespace: record.namespace, instance: record.id } satisfies JoinResponse)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpFailure) {
        for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value)
        json(res, error.status, error.body)
        return
      }
      log.error(`Fehler bei ${req.method} ${pathOf(req)}: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) json(res, 500, { error: 'internal', message: 'internal error' } satisfies HttpError)
      else res.destroy()
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 20_000

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy())
    if (pathOf(req) !== '/v1/ws') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => relay.accept(ws))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  server.on('error', (error) => log.error(`HTTP-Server: ${error.message}`))

  store.pruneInvites()
  const prune = setInterval(() => store.pruneInvites(), PRUNE_INVITES_MS)
  prune.unref()

  const { port } = server.address() as AddressInfo
  const host = config.host.includes(':') ? `[${config.host}]` : config.host
  return {
    url: `http://${host}:${port}`,
    port,
    relay,
    async close() {
      clearInterval(prune)
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeIdleConnections()
      await relay.close()
      wss.close()
      server.closeAllConnections()
      await closed
    },
  }
}

function pathOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return '/'
  }
}

function allow(req: IncomingMessage, method: 'GET' | 'POST'): void {
  if (req.method !== method) {
    throw new HttpFailure(405, 'method-not-allowed', 'method not allowed', { Allow: `${method}, OPTIONS` })
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  // The rest of an oversized body stays unread, so this connection cannot carry another request.
  const tooLarge = (): HttpFailure => new HttpFailure(413, 'too-large', 'body too large', { Connection: 'close' })
  if (Number(req.headers['content-length']) > limit) throw tooLarge()
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw tooLarge()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
