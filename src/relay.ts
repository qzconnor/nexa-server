/**
 * The relay: one WebSocket per instance, grouped by namespace. It forwards `body` as it comes and keeps
 * nothing of it. Before each message it asks the store whether sender and receiver still exist, so a
 * removal made by another process (the admin CLI) is enforced at the next message at the latest; the
 * heartbeat catches idle connections.
 */

import type { RawData, WebSocket } from 'ws'
import { isPublicKey, verifyAuth } from './auth.ts'
import { randomId } from './codes.ts'
import type { Logger } from './log.ts'
import {
  BROADCAST,
  CloseCode,
  MAX_PUSH_PAYLOAD,
  PROTOCOL_VERSION,
  PUSH_TTL_DEFAULT,
  parseClientMessage,
  type AuthMessage,
  type ClientRequest,
  type ErrorCode,
  type InstanceInfo,
  type PushRequest,
  type PushSubscribeRequest,
  type RelayedMessage,
  type ServerLimits,
  type ServerMessage,
} from './protocol.ts'
import type { InstanceRecord, Store } from './store.ts'
import { isPushService, pushHost, type PushOutcome, type PushSender } from './web-push.ts'

/** Pushes an instance may send at once, and how fast that refills: a burst of finished chats, not a flood. */
const PUSH_BURST = 30
const PUSH_PER_SECOND = 0.5

/** What the sender hears when the push service did not take a push. */
const PUSH_ERRORS: Record<Exclude<PushOutcome, 'ok'>, [ErrorCode, string]> = {
  gone: ['unsubscribed', 'the push service no longer knows this subscription'],
  'too-large': ['too-large', 'the push service refused the size'],
  'rate-limited': ['rate-limited', 'the push service asks to slow down'],
  rejected: ['internal', 'the push service refused the push'],
  unreachable: ['unreachable', 'the push service did not answer'],
}

export interface RelayOptions {
  store: Store
  log: Logger
  /** The WebSocket server enforces it (`maxPayload`); the relay only announces it in `ready`. */
  maxMessageBytes: number
  /** Messages per second and connection; bursts up to twice as many. */
  rateLimit: number
  /** Above this many unsent bytes a receiver counts as `busy`, so one slow reader cannot fill memory. */
  maxBufferedBytes: number
  authTimeoutMs?: number
  heartbeatMs?: number
  inviteTtlMs?: number
  /** Web Push, when the server offers it (with the web app); without it nobody can subscribe. */
  push?: PushSender | null
}

interface Connection {
  ws: WebSocket
  instance: string
  namespace: string
  tokens: number
  refilledAt: number
  /** Answered the last ping (or sent something) since the previous heartbeat. */
  alive: boolean
}

export class Relay {
  readonly #store: Store
  readonly #log: Logger
  readonly #rate: number
  readonly #limits: ServerLimits
  readonly #maxBuffered: number
  readonly #authTimeoutMs: number
  readonly #inviteTtlMs: number
  readonly #push: PushSender | null
  /** Push budget per sending instance, kept across its connections so reconnecting does not refill it. */
  readonly #pushTokens = new Map<string, { tokens: number; refilledAt: number }>()
  readonly #namespaces = new Map<string, Map<string, Connection>>()
  /** Every open socket, logged in or not; for the shutdown. */
  readonly #sockets = new Set<WebSocket>()
  readonly #heartbeat: NodeJS.Timeout

  constructor(options: RelayOptions) {
    this.#store = options.store
    this.#log = options.log
    this.#rate = options.rateLimit
    this.#limits = { maxMessageBytes: options.maxMessageBytes, rateLimit: options.rateLimit }
    this.#maxBuffered = options.maxBufferedBytes
    this.#authTimeoutMs = options.authTimeoutMs ?? 10_000
    this.#inviteTtlMs = options.inviteTtlMs ?? 15 * 60_000
    this.#push = options.push ?? null
    this.#heartbeat = setInterval(() => this.#beat(), options.heartbeatMs ?? 30_000)
    this.#heartbeat.unref()
  }

  /** Takes a freshly upgraded socket through the login and then serves it. */
  accept(ws: WebSocket): void {
    const nonce = randomId(32)
    let state: 'waiting' | 'verifying' | 'ready' = 'waiting'
    let connection: Connection | undefined
    this.#sockets.add(ws)
    const timer = setTimeout(() => ws.close(CloseCode.AuthFailed, 'auth timeout'), this.#authTimeoutMs)

    ws.on('message', (data, isBinary) => {
      if (state === 'ready') {
        this.#onMessage(connection!, data, isBinary)
        return
      }
      // A second message while the signature is checked: the client did not wait for `ready`.
      if (state === 'verifying') {
        ws.close(CloseCode.AuthFailed, 'wait for ready')
        return
      }
      state = 'verifying'
      const parsed = isBinary ? undefined : parseClientMessage(text(data))
      if (!parsed?.ok || parsed.msg.t !== 'auth') {
        ws.close(CloseCode.AuthFailed, 'auth expected')
        return
      }
      void this.#authenticate(ws, nonce, parsed.msg).then(
        (result) => {
          if (!result) return
          clearTimeout(timer)
          connection = result
          state = 'ready'
        },
        (error: unknown) => {
          this.#log.error(`Anmeldung fehlgeschlagen: ${describe(error)}`)
          ws.close(1011, 'internal error')
        },
      )
    })
    ws.on('pong', () => {
      if (connection) connection.alive = true
    })
    ws.on('close', () => {
      clearTimeout(timer)
      this.#sockets.delete(ws)
      if (connection) this.#onClose(connection)
    })
    ws.on('error', (error) => this.#log.debug(`WebSocket-Fehler: ${describe(error)}`))

    this.#send(ws, { t: 'hello', v: PROTOCOL_VERSION, nonce })
  }

  /** After `POST /v1/join`: tells the namespace about its new instance. */
  notifyJoined(record: InstanceRecord): void {
    this.#broadcast(record.namespace, { t: 'instance', event: 'joined', instance: this.#info(record) })
  }

  isOnline(id: string): boolean {
    for (const connections of this.#namespaces.values()) if (connections.has(id)) return true
    return false
  }

  get connectionCount(): number {
    let count = 0
    for (const connections of this.#namespaces.values()) count += connections.size
    return count
  }

  /**
   * Shutdown: closes every socket with 1001 so clients reconnect later, and cuts off whoever has not
   * finished the closing handshake after `graceMs`.
   */
  async close(graceMs = 1000): Promise<void> {
    clearInterval(this.#heartbeat)
    const sockets = [...this.#sockets]
    const closed = sockets.map((ws) => new Promise<void>((resolve) => ws.once('close', () => resolve())))
    for (const ws of sockets) ws.close(1001, 'server shutting down')
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, graceMs)))
    await Promise.race([Promise.all(closed), timeout])
    clearTimeout(timer)
    for (const ws of this.#sockets) ws.terminate()
  }

  // --- Login --------------------------------------------------------------------------------------

  async #authenticate(ws: WebSocket, nonce: string, msg: AuthMessage): Promise<Connection | undefined> {
    const known = this.#store.getInstance(msg.instance)
    if (!known) {
      ws.close(CloseCode.Removed, 'unknown instance')
      return undefined
    }
    const valid = await verifyAuth(known.signKey, nonce, msg.sig)
    // The client may have left or timed out while the signature was checked.
    if (ws.readyState !== ws.OPEN) return undefined
    if (!valid) {
      this.#log.debug(`Falsche Signatur für Instanz ${known.id}`)
      ws.close(CloseCode.AuthFailed, 'bad signature')
      return undefined
    }
    // Read again: it may have been removed or renamed meanwhile, and „last seen“ is now.
    this.#store.touchInstance(known.id)
    const record = this.#store.getInstance(known.id)
    if (!record) {
      ws.close(CloseCode.Removed, 'unknown instance')
      return undefined
    }

    let connections = this.#namespaces.get(record.namespace)
    if (!connections) {
      connections = new Map()
      this.#namespaces.set(record.namespace, connections)
    }
    const previous = connections.get(record.id)
    const connection: Connection = {
      ws,
      instance: record.id,
      namespace: record.namespace,
      tokens: this.#rate * 2,
      refilledAt: performance.now(),
      alive: true,
    }
    // Replace before closing, so the old socket's close handler sees it is no longer current.
    connections.set(record.id, connection)
    previous?.ws.close(CloseCode.Replaced, 'replaced by a newer connection')

    this.#send(ws, {
      t: 'ready',
      instance: record.id,
      namespace: record.namespace,
      instances: this.#instances(record.namespace),
      limits: { ...this.#limits },
    })
    if (!previous) {
      this.#broadcast(record.namespace, { t: 'instance', event: 'online', instance: this.#info(record) }, record.id)
    }
    this.#log.debug(`Instanz ${record.id} verbunden (Namespace „${record.namespace}“)`)
    return connection
  }

  #onClose(connection: Connection): void {
    const connections = this.#namespaces.get(connection.namespace)
    // Replaced or removed already: whoever did that has told the namespace.
    if (connections?.get(connection.instance) !== connection) return
    this.#forget(connection)
    this.#store.touchInstance(connection.instance)
    const record = this.#store.getInstance(connection.instance)
    if (record) this.#broadcast(record.namespace, { t: 'instance', event: 'offline', instance: this.#info(record) })
    this.#log.debug(`Instanz ${connection.instance} getrennt`)
  }

  // --- Requests -----------------------------------------------------------------------------------

  #onMessage(connection: Connection, data: RawData, isBinary: boolean): void {
    connection.alive = true
    if (!this.#takeToken(connection)) {
      this.#error(connection.ws, undefined, 'rate-limited', 'too many messages, this one was dropped')
      return
    }
    if (!this.#store.hasInstance(connection.instance)) {
      this.#removed(connection.namespace, connection.instance)
      return
    }
    const parsed = isBinary ? undefined : parseClientMessage(text(data))
    if (!parsed) {
      this.#error(connection.ws, undefined, 'bad-request', 'binary frames are not supported')
      return
    }
    if (!parsed.ok) {
      this.#error(connection.ws, parsed.re, 'bad-request', parsed.message)
      return
    }
    if (parsed.msg.t === 'auth') {
      this.#error(connection.ws, undefined, 'bad-request', 'already logged in')
      return
    }
    try {
      this.#handle(connection, parsed.msg)
    } catch (error) {
      // Only the type and the error, never the message itself: it may carry a body.
      this.#log.error(`Fehler bei „${parsed.msg.t}“ von Instanz ${connection.instance}: ${describe(error)}`)
      this.#error(connection.ws, parsed.msg.id, 'internal', 'internal error')
    }
  }

  #handle(connection: Connection, msg: ClientRequest): void {
    const { ws, namespace } = connection
    switch (msg.t) {
      case 'send':
        this.#relay(connection, msg.id, msg.to, msg.kind, msg.body)
        return
      case 'invite': {
        const invite = this.#store.createInvite(namespace, this.#inviteTtlMs, connection.instance)
        this.#send(ws, { t: 'invite', re: msg.id, code: invite.code, expiresAt: invite.expiresAt })
        this.#log.info(`Einladung für Namespace „${namespace}“ erstellt von Instanz ${connection.instance}`)
        return
      }
      case 'instances':
        this.#send(ws, { t: 'instances', re: msg.id, instances: this.#instances(namespace) })
        return
      case 'remove': {
        const target = this.#store.getInstance(msg.instance)
        if (target?.namespace !== namespace) {
          this.#error(ws, msg.id, 'unknown-instance', 'no such instance in this namespace')
          return
        }
        this.#store.removeInstance(target.id)
        this.#log.info(
          `Instanz ${target.id} („${target.name}“) aus Namespace „${namespace}“ entfernt von Instanz ${connection.instance}`,
        )
        // Answer first: when an instance removes itself, its socket closes right after.
        this.#send(ws, { t: 'ok', re: msg.id })
        this.#removed(namespace, target.id)
        return
      }
      case 'rename': {
        const target = this.#store.getInstance(msg.instance ?? connection.instance)
        if (target?.namespace !== namespace) {
          this.#error(ws, msg.id, 'unknown-instance', 'no such instance in this namespace')
          return
        }
        this.#store.renameInstance(target.id, msg.name)
        this.#send(ws, { t: 'ok', re: msg.id })
        this.#broadcast(namespace, { t: 'instance', event: 'renamed', instance: this.#info({ ...target, name: msg.name }) })
        return
      }
      case 'push-subscribe':
        this.#async(connection, msg, () => this.#subscribe(connection, msg))
        return
      case 'push-unsubscribe':
        this.#store.deletePushSubscription(connection.instance)
        this.#send(ws, { t: 'ok', re: msg.id })
        return
      case 'push':
        this.#async(connection, msg, () => this.#pushTo(connection, msg))
        return
    }
  }

  /** A request answered later; a failure there is answered like one in `#handle`. */
  #async(connection: Connection, msg: ClientRequest, run: () => Promise<void>): void {
    run().catch((error: unknown) => {
      this.#log.error(`Fehler bei „${msg.t}“ von Instanz ${connection.instance}: ${describe(error)}`)
      this.#error(connection.ws, msg.id, 'internal', 'internal error')
    })
  }

  // --- Push ---------------------------------------------------------------------------------------

  async #subscribe(connection: Connection, msg: PushSubscribeRequest): Promise<void> {
    const { ws } = connection
    if (!this.#push) {
      this.#error(ws, msg.id, 'bad-request', 'push is off on this server')
      return
    }
    if (!isPushService(msg.endpoint)) {
      this.#error(ws, msg.id, 'bad-request', 'endpoint: not a push service this server knows')
      return
    }
    if (!(await isPublicKey(msg.p256dh, 'dh'))) {
      this.#error(ws, msg.id, 'bad-request', 'p256dh: expected a raw P-256 public key')
      return
    }
    // Removed while the key was checked: nothing to subscribe for.
    if (!this.#store.hasInstance(connection.instance)) {
      this.#removed(connection.namespace, connection.instance)
      return
    }
    this.#store.setPushSubscription(connection.instance, { endpoint: msg.endpoint, p256dh: msg.p256dh, auth: msg.auth })
    this.#log.info(`Instanz ${connection.instance} empfängt Push über ${pushHost(msg.endpoint)}`)
    this.#send(ws, { t: 'ok', re: msg.id })
  }

  async #pushTo(connection: Connection, msg: PushRequest): Promise<void> {
    const { ws, namespace } = connection
    if (!this.#takePushToken(connection.instance)) {
      this.#error(ws, msg.id, 'rate-limited', 'too many pushes, this one was dropped')
      return
    }
    const target = this.#store.getInstance(msg.to)
    if (target?.namespace !== namespace) {
      this.#error(ws, msg.id, 'unknown-instance', 'no such instance in this namespace')
      return
    }
    const subscription = this.#push && this.#store.getPushSubscription(target.id)
    if (!this.#push || !subscription) {
      this.#error(ws, msg.id, 'unsubscribed', 'the instance has no push subscription')
      return
    }
    // The very message a `send` would relay, so the receiver opens it with the same code.
    const message: RelayedMessage = { t: 'msg', id: msg.id, from: connection.instance, to: target.id, kind: msg.kind }
    if (msg.body !== undefined) message.body = msg.body
    const payload = JSON.stringify(message)
    if (Buffer.byteLength(payload) > MAX_PUSH_PAYLOAD) {
      this.#error(ws, msg.id, 'too-large', `the push would carry more than ${MAX_PUSH_PAYLOAD} bytes`)
      return
    }

    const result = await this.#push.send(subscription, payload, { ttl: msg.ttl ?? PUSH_TTL_DEFAULT, urgency: msg.urgency ?? 'normal' })
    const service = pushHost(subscription.endpoint)
    if (result.outcome === 'ok') {
      this.#log.debug(`Push von Instanz ${connection.instance} an ${target.id} („${msg.kind}“) über ${service}`)
      this.#send(ws, { t: 'ok', re: msg.id })
      return
    }
    if (result.outcome === 'gone') {
      this.#store.deletePushSubscription(target.id, subscription.endpoint)
      this.#log.info(`Push-Anmeldung von Instanz ${target.id} gelöscht: ${service} kennt sie nicht mehr`)
    } else {
      const level = result.outcome === 'rejected' ? 'warn' : 'debug'
      this.#log[level](`Push an Instanz ${target.id} über ${service} ging nicht: ${result.status ?? result.outcome}`)
    }
    const [code, text] = PUSH_ERRORS[result.outcome]
    this.#error(ws, msg.id, code, text)
  }

  #takePushToken(instance: string): boolean {
    const now = performance.now()
    const bucket = this.#pushTokens.get(instance) ?? { tokens: PUSH_BURST, refilledAt: now }
    bucket.tokens = Math.min(PUSH_BURST, bucket.tokens + ((now - bucket.refilledAt) * PUSH_PER_SECOND) / 1000)
    bucket.refilledAt = now
    this.#pushTokens.set(instance, bucket)
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }

  #relay(connection: Connection, id: string, to: string, kind: string, body: unknown): void {
    const message: RelayedMessage = { t: 'msg', id, from: connection.instance, to, kind }
    if (body !== undefined) message.body = body
    const data = JSON.stringify(message)
    const connections = this.#namespaces.get(connection.namespace)!

    if (to === BROADCAST) {
      for (const target of connections.values()) if (target !== connection) this.#deliver(target, data)
      return
    }
    const target = connections.get(to)
    if (target) {
      const result = this.#deliver(target, data)
      if (result === 'busy') this.#error(connection.ws, id, 'busy', 'the instance does not keep up, try again later')
      if (result === 'gone') this.#error(connection.ws, id, 'unknown-instance', 'no such instance in this namespace')
      return
    }
    // Not connected: whether it exists decides between „offline“ and „unknown“. An instance of another
    // namespace answers like one that does not exist, so namespaces learn nothing about each other.
    if (this.#store.getInstance(to)?.namespace === connection.namespace) {
      this.#error(connection.ws, id, 'unreachable', 'the instance is not connected')
    } else {
      this.#error(connection.ws, id, 'unknown-instance', 'no such instance in this namespace')
    }
  }

  #deliver(target: Connection, data: string): 'ok' | 'busy' | 'gone' {
    if (!this.#store.hasInstance(target.instance)) {
      this.#removed(target.namespace, target.instance)
      return 'gone'
    }
    if (target.ws.bufferedAmount > this.#maxBuffered) return 'busy'
    target.ws.send(data)
    return 'ok'
  }

  // --- Removal and heartbeat ----------------------------------------------------------------------

  /** The instance is gone from the store: disconnect it and tell the rest of the namespace. */
  #removed(namespace: string, id: string): void {
    const connection = this.#namespaces.get(namespace)?.get(id)
    if (connection) {
      this.#forget(connection)
      connection.ws.close(CloseCode.Removed, 'instance removed')
    }
    this.#broadcast(namespace, { t: 'removed', instance: id })
  }

  #beat(): void {
    for (const [namespace, connections] of this.#namespaces) {
      for (const connection of connections.values()) {
        if (!connection.alive) {
          connection.ws.terminate()
          continue
        }
        if (!this.#store.touchInstance(connection.instance)) {
          this.#removed(namespace, connection.instance)
          continue
        }
        connection.alive = false
        connection.ws.ping()
      }
    }
  }

  // --- Helpers ------------------------------------------------------------------------------------

  #forget(connection: Connection): void {
    const connections = this.#namespaces.get(connection.namespace)
    if (!connections) return
    connections.delete(connection.instance)
    if (connections.size === 0) this.#namespaces.delete(connection.namespace)
  }

  #takeToken(connection: Connection): boolean {
    const now = performance.now()
    connection.tokens = Math.min(this.#rate * 2, connection.tokens + ((now - connection.refilledAt) * this.#rate) / 1000)
    connection.refilledAt = now
    if (connection.tokens < 1) return false
    connection.tokens -= 1
    return true
  }

  #info(record: InstanceRecord): InstanceInfo {
    return {
      id: record.id,
      name: record.name,
      role: record.role,
      signKey: record.signKey,
      dhKey: record.dhKey,
      createdAt: record.createdAt,
      lastSeen: record.lastSeen,
      online: this.isOnline(record.id),
    }
  }

  #instances(namespace: string): InstanceInfo[] {
    return this.#store.listInstances(namespace).map((record) => this.#info(record))
  }

  #broadcast(namespace: string, message: ServerMessage, except?: string): void {
    const connections = this.#namespaces.get(namespace)
    if (!connections) return
    const data = JSON.stringify(message)
    for (const connection of connections.values()) {
      if (connection.instance !== except && connection.ws.readyState === connection.ws.OPEN) connection.ws.send(data)
    }
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }

  #error(ws: WebSocket, re: string | undefined, code: ErrorCode, message: string): void {
    this.#send(ws, re === undefined ? { t: 'error', code, message } : { t: 'error', re, code, message })
  }
}

function text(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
