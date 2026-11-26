import type { Key } from '@shared/nexa-server/auth'
import { openSealed, pairwiseKey, PAIRWISE, parseSealed, randomMessageId, seal, verifyOpened } from '@shared/nexa-server/envelope'
import { ReplayGuard, type Member } from '@shared/nexa-server/members'
import type { RelayedMessage } from '@shared/nexa-server/protocol'
import { DEFAULT_SERVER_LIMITS } from '@shared/nexa-server/server-messages'
import type { Identity } from './link-store'

/** Room for the JSON around a sealed body in a `send` (type, id, receiver, kind): about 100 bytes, generously. */
const SEND_HEADROOM = 1024

/**
 * The `kind` of a piece of a message too large for one: `{ m, k, i, n, s }`, the whole message's id and
 * kind, the piece's place of all of them and its part of the JSON. Starts with `rc.`, as the link passes
 * on only those to Remote Control.
 */
export const PART_KIND = 'rc.part'
/** A message goes in at most this many pieces (about 48 MB with a server that takes 1 MiB). */
const MAX_PARTS = 64
/** Room in a piece for what is around its text: `{"m":…,"k":…,"i":…,"n":…,"s":"…"}`. */
const PART_HEADROOM = 256
/** The pieces of a message that don't all come within this time are dropped (one was refused on the way). */
const PART_TTL_MS = 60_000
/** Messages in pieces one member may have under way at once. */
const MAX_ASSEMBLIES = 16
/** Piece ids kept with the id of their message, so a refused piece names the message it belongs to. */
const PARTS_KEPT = 1024
const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/
const KIND = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/

/**
 * The largest sealed body this device sends to a server that takes messages of `maxMessageBytes`.
 * Over that nexa-server closes the connection, which would cut off everything else too.
 */
export function sealedLimit(maxMessageBytes: number): number {
  return maxMessageBytes - SEND_HEADROOM
}

/**
 * About how much JSON (UTF-8 bytes) fits into one sealed message: the envelope adds the signature (64
 * bytes), `{"at":…,"d":…}`, the tag (16) and base64url (4 bytes for 3).
 */
export function payloadLimit(maxMessageBytes: number): number {
  return Math.max(0, Math.floor(((sealedLimit(maxMessageBytes) - 128) * 3) / 4) - 128)
}

export class MessageTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`message too large for the relay: ${bytes} bytes`)
  }
}

/** UTF-8 bytes of a character code (a surrogate counts half of its pair's four). */
function utf8Of(code: number): number {
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdfff ? 2 : 3
}

/** UTF-8 bytes of `text`. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) bytes += utf8Of(text.charCodeAt(i))
  return bytes
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff

/** Bytes of one UTF-16 unit inside a JSON string, as `JSON.stringify` writes it (not for a surrogate pair). */
function jsonUnitBytes(code: number): number {
  if (code === 0x22 || code === 0x5c) return 2
  // \b \t \n \f \r, the other control characters as \u00XX.
  if (code < 0x20) return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
  // A lone surrogate isn't UTF-8: JSON writes it as \uXXXX.
  if (code >= 0xd800 && code <= 0xdfff) return 6
  return utf8Of(code)
}

/**
 * `text` in pieces that each take at most `maxBytes` as a JSON string (UTF-8, escapes counted), never
 * between the two halves of a character. A piece holds at least one character, even one over `maxBytes`.
 */
export function splitForJson(text: string, maxBytes: number): string[] {
  const pieces: string[] = []
  let start = 0
  let bytes = 0
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i)
    // A surrogate pair is one character of four bytes: it has to fit whole, or it starts the next piece.
    const pair = isHigh(code) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))
    const size = pair ? 4 : jsonUnitBytes(code)
    if (bytes + size > maxBytes && i > start) {
      pieces.push(text.slice(start, i))
      start = i
      bytes = 0
    }
    bytes += size
    i += pair ? 2 : 1
  }
  if (start < text.length || !pieces.length) pieces.push(text.slice(start))
  return pieces
}

export interface DeviceChannelDeps {
  instance: string
  identity: Identity
  /** A member of the namespace in this device's own eyes (`Membership`); others get and give nothing. */
  member(id: string): Member | undefined
  /** Relays a sealed body; false when not connected. */
  send(to: string, kind: string, id: string, body: unknown): boolean
  /** The server's limit of a message (`ready`), in bytes. */
  maxMessageBytes?: () => number
  now?: () => number
}

/** A message whose pieces come. */
interface Assembly {
  from: string
  kind: string
  pieces: (string | undefined)[]
  count: number
  at: number
}

/** A message as `receive` opened it: for a message in pieces the whole one's kind and id. */
export interface OpenedMessage {
  kind: string
  id: string
  data: unknown
}

/**
 * Messages between two members other than the membership's own (Remote Control): sealed with the key
 * only these two share (ECDH of their keys, `PAIRWISE`), signed by the sender, each taken once. The
 * server sees who talks to whom and how much, nothing else; other members can't read along either.
 * What is larger than the server takes goes in pieces (`PART_KIND`), each sealed on its own.
 */
export class DeviceChannel {
  private readonly guard = new ReplayGuard()
  private readonly pairKeys = new Map<string, Promise<Key | null>>()
  private sending: Promise<unknown> = Promise.resolve()
  private receiving: Promise<unknown> = Promise.resolve()
  private readonly assemblies = new Map<string, Assembly>()
  /** Piece → its message. */
  private readonly partOf = new Map<string, string>()

  constructor(private readonly deps: DeviceChannelDeps) {}

  /**
   * Seals `data` for the member `to` and relays it, in pieces if it is larger than the server takes: the
   * message's id (an answer names it), or null when `to` isn't a member or the connection is down.
   * Throws `MessageTooLargeError` for what would take too many pieces. Messages leave in the order of
   * the calls, however long each one's sealing takes: streamed text has to arrive in its order.
   */
  send(to: string, kind: string, data: unknown): Promise<string | null> {
    const json = JSON.stringify(data) ?? 'null'
    const limit = payloadLimit(this.maxMessageBytes())
    const bytes = utf8Length(json)
    let id: string
    let sealed: Promise<{ id: string; body: unknown } | null>[]
    if (bytes <= limit) {
      id = randomMessageId()
      sealed = [this.sealFor(to, kind, id, data)]
    } else {
      const pieces = splitForJson(json, limit - PART_HEADROOM)
      if (pieces.length > MAX_PARTS) return Promise.reject(new MessageTooLargeError(bytes))
      id = randomMessageId()
      const n = pieces.length
      sealed = pieces.map((s, i) => {
        const partId = randomMessageId()
        this.remember(partId, id)
        return this.sealFor(to, PART_KIND, partId, { m: id, k: kind, i, n, s })
      })
    }
    // Awaited in turn below; until then a failure (too large) mustn't count as unhandled.
    for (const each of sealed) each.catch(() => undefined)
    const sent = this.sending.then(async () => {
      for (const each of sealed) {
        const message = await each
        if (!message) return null
        const relayed = message.id === id ? this.deps.send(to, kind, message.id, message.body) : this.deps.send(to, PART_KIND, message.id, message.body)
        if (!relayed) return null
      }
      return id
    })
    this.sending = sent.catch(() => undefined)
    return sent
  }

  /** The message a piece the server refused belongs to (the piece's own id for a whole message). */
  messageOf(id: string): string {
    return this.partOf.get(id) ?? id
  }

  private remember(partId: string, id: string): void {
    this.partOf.set(partId, id)
    if (this.partOf.size > PARTS_KEPT) this.partOf.delete(this.partOf.keys().next().value!)
  }

  private maxMessageBytes(): number {
    return this.deps.maxMessageBytes?.() ?? DEFAULT_SERVER_LIMITS.maxMessageBytes
  }

  private async sealFor(to: string, kind: string, id: string, data: unknown): Promise<{ id: string; body: unknown } | null> {
    const member = this.deps.member(to)
    const key = member && (await this.pairKey(member))
    if (!key) return null
    const body = await seal({
      header: { from: this.deps.instance, to, kind, id },
      keyRef: PAIRWISE,
      key,
      data,
      signKey: this.deps.identity.signPrivate,
      now: this.now(),
    })
    const bytes = JSON.stringify(body).length
    // The body is ASCII (base64url and names), so its length is its size in bytes.
    if (bytes > sealedLimit(this.maxMessageBytes())) throw new MessageTooLargeError(bytes)
    return { id, body }
  }

  /**
   * What a member sealed for this device alone, checked; null for anything else, and for a piece until
   * the last one of its message came. In the order they came.
   */
  receive(msg: RelayedMessage): Promise<OpenedMessage | null> {
    // Opened side by side, which takes each its own time; taken in, pieces too, in the order they came:
    // a message is whole with its last piece, not with whichever was opened last.
    const opened = this.open(msg)
    opened.catch(() => undefined)
    const result = this.receiving.then(async () => {
      const message = await opened
      return message?.kind === PART_KIND ? this.piece(msg.from, message.data) : message
    })
    this.receiving = result.catch(() => undefined)
    return result
  }

  private async open(msg: RelayedMessage): Promise<OpenedMessage | null> {
    if (msg.to !== this.deps.instance) return null
    const member = this.deps.member(msg.from)
    const sealed = parseSealed(msg.body)
    if (!member || sealed?.k !== PAIRWISE) return null
    const key = await this.pairKey(member)
    const opened = key && (await openSealed({ from: msg.from, to: msg.to, kind: msg.kind, id: msg.id }, sealed, key))
    if (!opened || !(await verifyOpened(opened, member.signKey))) return null
    if (!this.guard.accept(msg.from, msg.id, opened.at, this.now())) return null
    // A piece too: `receive` puts it into its message.
    return { kind: msg.kind, id: msg.id, data: opened.data }
  }

  /** A piece into its message; the message once it is whole. */
  private piece(from: string, data: unknown): OpenedMessage | null {
    const now = this.now()
    for (const [key, assembly] of this.assemblies) if (now - assembly.at > PART_TTL_MS) this.assemblies.delete(key)
    if (typeof data !== 'object' || data === null) return null
    const { m, k, i, n, s } = data as Record<string, unknown>
    if (typeof m !== 'string' || !MESSAGE_ID.test(m) || typeof k !== 'string' || !KIND.test(k) || k === PART_KIND) return null
    if (!Number.isInteger(n) || (n as number) < 2 || (n as number) > MAX_PARTS || !Number.isInteger(i) || (i as number) < 0 || (i as number) >= (n as number)) return null
    if (typeof s !== 'string') return null
    const key = `${from} ${m}`
    let assembly = this.assemblies.get(key)
    if (assembly && (assembly.kind !== k || assembly.pieces.length !== n)) {
      this.assemblies.delete(key)
      return null
    }
    if (!assembly) {
      const own = [...this.assemblies.entries()].filter(([, a]) => a.from === from)
      if (own.length >= MAX_ASSEMBLIES) this.assemblies.delete(own[0][0])
      assembly = { from, kind: k, pieces: new Array<string | undefined>(n as number), count: 0, at: now }
      this.assemblies.set(key, assembly)
    }
    if (assembly.pieces[i as number] === undefined) assembly.count++
    assembly.pieces[i as number] = s
    if (assembly.count < assembly.pieces.length) return null
    this.assemblies.delete(key)
    try {
      return { kind: k, id: m, data: JSON.parse(assembly.pieces.join('')) as unknown }
    } catch {
      return null
    }
  }

  private pairKey(member: Member): Promise<Key | null> {
    // By id and key: a member taken in anew under the same id (after a key share) has other keys.
    const cacheKey = `${member.id} ${member.dhKey}`
    let key = this.pairKeys.get(cacheKey)
    if (!key) {
      key = pairwiseKey({ id: this.deps.instance, dhPrivate: this.deps.identity.dhPrivate }, { id: member.id, dhKey: member.dhKey }).catch(() => null)
      this.pairKeys.set(cacheKey, key)
    }
    return key
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
