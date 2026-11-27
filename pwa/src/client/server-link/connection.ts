// The PWA of nexa-server copies this file byte for byte: no Node APIs, no new relative imports
// (pwa-copies.test.ts).
import { signAuth, type Key } from '@shared/nexa-server/auth'
import {
  CloseCode,
  PROTOCOL_VERSION,
  type ErrorCode,
  type InstanceEvent,
  type PushRequest,
  type PushSubscribeRequest,
  type ReadyMessage,
  type RelayedMessage,
  type RemovedEvent,
  type ServerMessage,
} from '@shared/nexa-server/protocol'
import { parseServerMessage } from '@shared/nexa-server/server-messages'
import { TypedEmitter } from '../lib/typed-emitter'

/** What the connection needs of a WebSocket; `browserSocket` adapts the global one. */
export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SocketFactory = (url: string) => SocketLike

/** The WebSocket of Node (and so of Electron's main process), which answers the server's pings itself. */
export function browserSocket(url: string): SocketLike {
  const ws = new WebSocket(url)
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  }
  ws.onopen = () => socket.onopen?.()
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data })
  ws.onclose = (event) => socket.onclose?.({ code: event.code, reason: event.reason })
  ws.onerror = () => socket.onerror?.()
  return socket
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'stopped'

/**
 * Why the connection stopped for good. `auth-failed` (4401), `replaced` (4409) and `protocol` must not
 * loop: a wrong key stays wrong, and two copies of one device would push each other out forever.
 */
export type StopReason = 'user' | 'auth-failed' | 'removed' | 'replaced' | 'protocol'

/** An `error` of the server for a request. `code` decides what the user is told. */
export class ServerError extends Error {
  constructor(
    readonly code: ErrorCode | 'offline' | 'timeout',
    message: string,
  ) {
    super(message)
  }
}

type Events = {
  status: [status: ConnectionStatus]
  ready: [ready: ReadyMessage]
  relayed: [msg: RelayedMessage]
  /** The server refused a `send` (its id): e.g. `unreachable` when the other device isn't connected. */
  sendFailed: [id: string, error: ServerError]
  instance: [event: InstanceEvent | RemovedEvent]
  stopped: [reason: StopReason]
}

/**
 * Requests that get an answer; `send` gets none, only an error if it fails. A push brings its own id: it
 * is the sealed message's, which the receiver checks.
 */
type Request =
  | { t: 'invite' }
  | { t: 'instances' }
  | { t: 'remove'; instance: string }
  | { t: 'rename'; instance?: string; name: string }
  | Omit<PushSubscribeRequest, 'id'>
  | { t: 'push-unsubscribe' }
  | PushRequest

export interface ConnectionOptions {
  /** `wss://…/v1/ws`. */
  url: string
  instance: string
  /** The instance's private ECDSA key. */
  signKey: Key
  socket?: SocketFactory
  /** For messages that help to understand a problem; never content. */
  log?: (message: string) => void
}

const HANDSHAKE_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 15_000
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 60_000

/**
 * One WebSocket to nexa-server for this instance: logs in by signing the server's nonce, answers
 * requests by their id, passes on relayed messages and events, and connects again after a loss, waiting
 * longer each time. Close codes that a new attempt can't fix stop it (`StopReason`).
 */
export class ServerConnection extends TypedEmitter<Events> {
  private current: ConnectionStatus = 'stopped'
  private socket: SocketLike | null = null
  private attempt = 0
  private nextRetry: number | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pending = new Map<string, { resolve: (msg: ServerMessage) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private counter = 0

  constructor(private readonly options: ConnectionOptions) {
    super()
  }

  get status(): ConnectionStatus {
    return this.current
  }

  /** When the next attempt starts while `offline`. */
  get retryAt(): number | null {
    return this.nextRetry
  }

  start(): void {
    if (this.current !== 'stopped') return
    this.attempt = 0
    this.open()
  }

  /** Tries at once instead of waiting for the next attempt, e.g. after the computer woke up. */
  retryNow(): void {
    if (this.current !== 'offline') return
    this.clearRetry()
    this.open()
  }

  stop(reason: StopReason = 'user'): void {
    if (this.current === 'stopped') return
    this.clearRetry()
    this.drop(1000)
    this.setStatus('stopped')
    this.emit('stopped', reason)
  }

  /** Sends a request and waits for its answer; an `error` of the server rejects with `ServerError`. */
  request(request: Request): Promise<ServerMessage> {
    if (this.current !== 'online' || !this.socket) return Promise.reject(new ServerError('offline', 'not connected'))
    const id = 'id' in request ? request.id : `r${++this.counter}`
    const socket = this.socket
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ServerError('timeout', 'no answer'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ ...request, id }))
    })
  }

  /** Relays `body` to one instance or to all (`*`). Errors of the server for it are only logged. */
  send(to: string, kind: string, id: string, body: unknown): boolean {
    if (this.current !== 'online' || !this.socket) return false
    this.socket.send(JSON.stringify({ t: 'send', id, to, kind, body }))
    return true
  }

  private open(): void {
    this.nextRetry = null
    this.setStatus('connecting')
    let socket: SocketLike
    try {
      socket = (this.options.socket ?? browserSocket)(this.options.url)
    } catch (error) {
      this.options.log?.(`connect failed: ${error instanceof Error ? error.message : String(error)}`)
      this.scheduleRetry()
      return
    }
    this.socket = socket
    let authed = false
    this.handshakeTimer = setTimeout(() => {
      this.options.log?.('no login within the time limit')
      this.drop(1000)
      this.scheduleRetry()
    }, HANDSHAKE_TIMEOUT_MS)

    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      const msg = parseServerMessage(event.data)
      if (!msg) {
        this.options.log?.('dropped a message that is not protocol 1')
        return
      }
      if (this.current === 'connecting') {
        if (msg.t === 'hello' && !authed) {
          if (msg.v !== PROTOCOL_VERSION) {
            this.stop('protocol')
            return
          }
          authed = true
          void signAuth(this.options.signKey, msg.nonce).then((sig) => {
            if (this.socket === socket) socket.send(JSON.stringify({ t: 'auth', instance: this.options.instance, sig }))
          })
        } else if (msg.t === 'ready' && authed) {
          this.clearHandshake()
          this.attempt = 0
          this.setStatus('online')
          this.emit('ready', msg)
        }
        return
      }
      this.dispatch(msg)
    }
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.clearHandshake()
      this.rejectPending()
      const reason = closeReason(event.code)
      if (reason) {
        this.options.log?.(`closed by the server: ${event.code}`)
        this.setStatus('stopped')
        this.emit('stopped', reason)
        return
      }
      if (this.current !== 'stopped') this.scheduleRetry()
    }
    socket.onerror = () => {
      // A close follows; it decides what happens.
    }
  }

  private dispatch(msg: ServerMessage): void {
    const re = 're' in msg ? msg.re : undefined
    const waiting = re === undefined ? undefined : this.pending.get(re)
    if (waiting && re !== undefined) {
      clearTimeout(waiting.timer)
      this.pending.delete(re)
      if (msg.t === 'error') waiting.reject(new ServerError(msg.code, msg.message))
      else waiting.resolve(msg)
      return
    }
    switch (msg.t) {
      case 'msg':
        this.emit('relayed', msg)
        break
      case 'instance':
      case 'removed':
        this.emit('instance', msg)
        break
      case 'error':
        // An error for a `send` (e.g. `unreachable`): whoever waits for an answer to it learns at once.
        if (msg.re !== undefined) this.emit('sendFailed', msg.re, new ServerError(msg.code, msg.message))
        else this.options.log?.(`server error: ${msg.code}`)
        break
    }
  }

  private scheduleRetry(): void {
    const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.attempt)
    // Spread out, so devices that lost the server together don't all come back at the same moment.
    const delay = Math.round(base * (0.75 + Math.random() * 0.5))
    this.attempt++
    this.nextRetry = Date.now() + delay
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.open()
    }, delay)
    this.setStatus('offline')
  }

  private drop(code: number): void {
    const socket = this.socket
    this.socket = null
    this.clearHandshake()
    this.rejectPending()
    if (!socket) return
    try {
      socket.close(code)
    } catch {
      // Closed already.
    }
  }

  private rejectPending(): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new ServerError('offline', 'connection lost'))
    }
    this.pending.clear()
  }

  private clearHandshake(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = null
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.nextRetry = null
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.current === status) return
    this.current = status
    this.emit('status', status)
  }
}

function closeReason(code: number): StopReason | null {
  switch (code) {
    case CloseCode.AuthFailed:
      return 'auth-failed'
    case CloseCode.Removed:
      return 'removed'
    case CloseCode.Replaced:
      return 'replaced'
    default:
      return null
  }
}
