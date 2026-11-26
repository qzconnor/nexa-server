/**
 * The wire protocol of nexa-server, version 1: the messages over `/v1/ws` and `POST /v1/join`, their
 * validation and the constants both sides need. Free of Node APIs on purpose, so the desktop app and the
 * PWA can take this file over unchanged. `docs/PROTOCOL.md` describes the same in prose.
 */

export const PROTOCOL_VERSION = 1

export type Role = 'host' | 'controller'
export const ROLES: readonly Role[] = ['host', 'controller']

/** `to` of a `send` that goes to every other instance of the namespace. */
export const BROADCAST = '*'

/**
 * Prefix of the text an instance signs to log in; the nonce of `hello` follows. The context string keeps
 * a signature made for this purpose from being valid for anything else the key might ever sign.
 */
export const AUTH_CONTEXT = 'nexa-server/auth/v1:'

export function authPayload(nonce: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(AUTH_CONTEXT + nonce)
}

/** Close codes of the WebSocket beyond the standard ones (1001 shutdown, 1009 message too large). */
export const CloseCode = {
  /** No `auth` within the time limit, a wrong signature, or anything but `auth` before `ready`. */
  AuthFailed: 4401,
  /** The instance no longer exists: removed by another instance or the admin. The pairing is gone. */
  Removed: 4403,
  /** A newer connection of the same instance took over. Reconnecting on this would make both fight. */
  Replaced: 4409,
} as const

export type ErrorCode =
  /** A malformed message or field. */
  | 'bad-request'
  /** `to` or `instance` is no instance of this namespace. Other namespaces look the same as nothing. */
  | 'unknown-instance'
  /** The instance exists but is not connected. Nothing is stored for later. */
  | 'unreachable'
  /** The instance is connected but does not keep up with reading; try again later. */
  | 'busy'
  /** Too many messages on this connection; this one was dropped. */
  | 'rate-limited'
  /** Join: the invite is unknown, used or expired. */
  | 'invite-invalid'
  /** Join: the namespace has as many instances as the server allows. */
  | 'namespace-full'
  | 'internal'

/** An instance as the server shows it to the instances of its namespace. */
export interface InstanceInfo {
  id: string
  name: string
  role: Role
  /** P-256 public key for ECDSA (login), raw uncompressed point (65 bytes), base64url. */
  signKey: string
  /** P-256 public key for ECDH (handing a new namespace key to exactly this instance), raw, base64url. */
  dhKey: string
  /** Milliseconds since the epoch, like every time in this protocol. */
  createdAt: number
  lastSeen: number | null
  online: boolean
}

// --- HTTP -----------------------------------------------------------------------------------------

/** `GET /` and `GET /v1/info`. */
export interface ServerInfo {
  name: 'nexa-server'
  version: string
  protocol: typeof PROTOCOL_VERSION
  /** Whether this server serves the web app at `/app` (`NEXA_PWA`); a QR link to it only works then. */
  pwa: boolean
}

/** Body of `POST /v1/join`. */
export interface JoinRequest {
  invite: string
  name: string
  role: Role
  signKey: string
  dhKey: string
}

/** Answer of `POST /v1/join` (201). */
export interface JoinResponse {
  namespace: string
  instance: string
}

/** Body of every HTTP error. */
export interface HttpError {
  error: ErrorCode | 'not-found' | 'method-not-allowed' | 'unsupported-media-type' | 'too-large'
  message: string
}

// --- Client → server ------------------------------------------------------------------------------

/** The only message allowed before `ready`. `sig` is ECDSA P-256/SHA-256 over `authPayload(nonce)`. */
export interface AuthMessage {
  t: 'auth'
  instance: string
  /** IEEE P1363 (r ‖ s, 64 bytes) as WebCrypto produces it, base64url. */
  sig: string
}

/** Relay `body` to one instance or to all others (`to: '*'`). The server never looks into `body`. */
export interface SendMessage {
  t: 'send'
  id: string
  to: string
  kind: string
  body?: unknown
}

/** A one-time invite for another device, valid for 15 minutes. */
export interface InviteRequest {
  t: 'invite'
  id: string
}

export interface InstancesRequest {
  t: 'instances'
  id: string
}

/** Remove an instance of the namespace, this one included. */
export interface RemoveRequest {
  t: 'remove'
  id: string
  instance: string
}

/** Rename an instance of the namespace; without `instance` this one. */
export interface RenameRequest {
  t: 'rename'
  id: string
  instance?: string
  name: string
}

export type ClientRequest = SendMessage | InviteRequest | InstancesRequest | RemoveRequest | RenameRequest
export type ClientMessage = AuthMessage | ClientRequest

// --- Server → client ------------------------------------------------------------------------------

export interface HelloMessage {
  t: 'hello'
  v: typeof PROTOCOL_VERSION
  nonce: string
}

export interface ReadyMessage {
  t: 'ready'
  instance: string
  namespace: string
  /** All instances of the namespace, this one included. */
  instances: InstanceInfo[]
  /** What this server allows a connection; clients size their messages by it. */
  limits: ServerLimits
}

export interface ServerLimits {
  /** Largest message a client may send, in bytes, the whole JSON (`maxPayload`); larger closes the connection. */
  maxMessageBytes: number
  /** Messages per second per connection (bursts up to twice as many); beyond it they are dropped (`rate-limited`). */
  rateLimit: number
}

export interface RelayedMessage {
  t: 'msg'
  id: string
  from: string
  /** The receiving instance, or `*` for a broadcast. */
  to: string
  kind: string
  body?: unknown
}

export interface InviteResponse {
  t: 'invite'
  re: string
  code: string
  expiresAt: number
}

export interface InstancesResponse {
  t: 'instances'
  re: string
  instances: InstanceInfo[]
}

/** Answer to `remove` and `rename`; the change itself comes as an event to everyone. */
export interface OkResponse {
  t: 'ok'
  re: string
}

/** To the other instances (`renamed`: to all) when one joins, comes online, goes offline or is renamed. */
export interface InstanceEvent {
  t: 'instance'
  event: 'joined' | 'online' | 'offline' | 'renamed'
  instance: InstanceInfo
}

/** To the remaining instances when one was removed, also when the admin removed it. */
export interface RemovedEvent {
  t: 'removed'
  instance: string
}

export interface ErrorMessage {
  t: 'error'
  /** The `id` of the request it answers, if the server could read it. */
  re?: string
  code: ErrorCode
  /** For developers, in English; show the user something based on `code`. */
  message: string
}

export type ServerMessage =
  | HelloMessage
  | ReadyMessage
  | RelayedMessage
  | InviteResponse
  | InstancesResponse
  | OkResponse
  | InstanceEvent
  | RemovedEvent
  | ErrorMessage

// --- Validation -----------------------------------------------------------------------------------

export const MAX_NAME_LENGTH = 64

const REQUEST_ID = /^[\x21-\x7e]{1,128}$/
const INSTANCE_ID = /^[A-Za-z0-9_-]{1,64}$/
const KIND = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/
const BASE64URL = /^[A-Za-z0-9_-]{1,256}$/
// Bidi overrides would let a device name display as something else in the list of devices.
const FORBIDDEN_IN_NAME = /[\p{Cc}‪-‮⁦-⁩]/u

export function isInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID.test(value)
}

/** The name of a device as it is stored: trimmed, whitespace collapsed; null if not acceptable. */
export function normalizeInstanceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || FORBIDDEN_IN_NAME.test(name)) return null
  return name
}

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; re?: string; message: string }

/**
 * Reads one text frame of a client. The result holds only the known fields, so whatever else a client
 * puts in a message never reaches another instance.
 */
export function parseClientMessage(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, message: 'not JSON' }
  }
  if (!isRecord(data)) return { ok: false, message: 'not a JSON object' }

  const re = typeof data.id === 'string' && REQUEST_ID.test(data.id) ? data.id : undefined
  const fail = (message: string): ParseResult => ({ ok: false, re, message })

  if (data.t === 'auth') {
    if (!isInstanceId(data.instance)) return fail('instance: invalid')
    if (typeof data.sig !== 'string' || !BASE64URL.test(data.sig)) return fail('sig: expected base64url')
    return { ok: true, msg: { t: 'auth', instance: data.instance, sig: data.sig } }
  }

  if (typeof data.t !== 'string') return fail('t: missing')
  if (re === undefined) return fail('id: expected 1 to 128 printable ASCII characters')

  switch (data.t) {
    case 'send': {
      if (data.to !== BROADCAST && !isInstanceId(data.to)) return fail('to: expected an instance or "*"')
      if (typeof data.kind !== 'string' || !KIND.test(data.kind)) return fail('kind: invalid')
      const msg: SendMessage = { t: 'send', id: re, to: data.to as string, kind: data.kind }
      if (data.body !== undefined) msg.body = data.body
      return { ok: true, msg }
    }
    case 'invite':
    case 'instances':
      return { ok: true, msg: { t: data.t, id: re } }
    case 'remove':
      if (!isInstanceId(data.instance)) return fail('instance: invalid')
      return { ok: true, msg: { t: 'remove', id: re, instance: data.instance } }
    case 'rename': {
      if (data.instance !== undefined && !isInstanceId(data.instance)) return fail('instance: invalid')
      const name = normalizeInstanceName(data.name)
      if (name === null) return fail(`name: expected 1 to ${MAX_NAME_LENGTH} characters`)
      const msg: RenameRequest = { t: 'rename', id: re, name }
      if (data.instance !== undefined) msg.instance = data.instance
      return { ok: true, msg }
    }
    default:
      return fail(`t: unknown type "${data.t.slice(0, 32)}"`)
  }
}

export type JoinParseResult = { ok: true; value: JoinRequest } | { ok: false; message: string }

/** Checks the shape of a join; whether the keys are real P-256 keys is up to the server (`auth.ts`). */
export function parseJoinRequest(data: unknown): JoinParseResult {
  if (!isRecord(data)) return { ok: false, message: 'expected a JSON object' }
  if (typeof data.invite !== 'string' || data.invite.length === 0 || data.invite.length > 64) {
    return { ok: false, message: 'invite: missing' }
  }
  const name = normalizeInstanceName(data.name)
  if (name === null) return { ok: false, message: `name: expected 1 to ${MAX_NAME_LENGTH} characters` }
  if (!ROLES.includes(data.role as Role)) return { ok: false, message: 'role: expected "host" or "controller"' }
  if (typeof data.signKey !== 'string' || !BASE64URL.test(data.signKey)) {
    return { ok: false, message: 'signKey: expected base64url' }
  }
  if (typeof data.dhKey !== 'string' || !BASE64URL.test(data.dhKey)) {
    return { ok: false, message: 'dhKey: expected base64url' }
  }
  return {
    ok: true,
    value: { invite: data.invite, name, role: data.role as Role, signKey: data.signKey, dhKey: data.dhKey },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
