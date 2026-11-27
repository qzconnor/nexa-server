/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and its message encryption (RFC 8291, aes128gcm of RFC
 * 8188), over node:crypto and fetch: a push carries a few hundred bytes, that needs no library. The
 * payload is already sealed between the devices; this layer only keeps the push service out of it.
 */

import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { fromBase64url, toBase64url } from './auth.ts'
import type { PushUrgency } from './protocol.ts'

/**
 * The push services of the browsers that can install the web app (Chrome and Android, Firefox, Safari,
 * Edge). Only these: the server posts to the endpoint a client names, which must not reach anything else.
 */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com'])
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com']

/** Whether the server may post to `endpoint`: https on the default port, at a push service it knows. */
export function isPushService(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/**
 * Whether a push the receiver may show nothing for can go to `endpoint`. Not to Apple's push service:
 * Safari, the web app on an iPhone too, drops the subscription of a page after a few such pushes. Chrome
 * and Firefox put up with some; beyond them Chrome shows a note of its own.
 */
export function allowsSilentPush(endpoint: string): boolean {
  return !pushHost(endpoint).toLowerCase().endsWith('.push.apple.com')
}

/** The host of an endpoint, for logs: the endpoint itself is a capability and never logged. */
export function pushHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname
  } catch {
    return '?'
  }
}

// --- VAPID ------------------------------------------------------------------------------------------

/** The server's VAPID key pair: public raw (65 bytes), private PKCS#8, both base64url. */
export interface VapidKeys {
  publicKey: string
  privateKey: string
}

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')])
  return { publicKey: toBase64url(raw), privateKey: toBase64url(privateKey.export({ format: 'der', type: 'pkcs8' })) }
}

/** How long a VAPID token is valid; push services take up to 24 hours. */
const TOKEN_LIFETIME_S = 12 * 3600
/** A token is used for a while instead of signing one per push. */
const TOKEN_REUSE_MS = 3600_000

function jwtPart(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** A VAPID JWT (ES256) for the push service at `audience` (its origin). */
export function vapidToken(audience: string, subject: string, key: KeyObject, now: number): string {
  const unsigned = `${jwtPart({ typ: 'JWT', alg: 'ES256' })}.${jwtPart({ aud: audience, exp: Math.floor(now / 1000) + TOKEN_LIFETIME_S, sub: subject })}`
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' })
  return `${unsigned}.${signature.toString('base64url')}`
}

// --- Encryption (RFC 8291) --------------------------------------------------------------------------

/** Record size in the header; one record holds the whole payload (`MAX_PUSH_PAYLOAD`). */
const RECORD_SIZE = 4096

export interface EncryptOptions {
  /** Only for tests (the RFC's example): the server's ephemeral private key and the salt. */
  asPrivate?: Uint8Array
  salt?: Uint8Array
}

/**
 * The body of a push for a subscription: header (salt, record size, the server's ephemeral public key)
 * and one record, the payload with its delimiter encrypted under a key derived from ECDH with the
 * subscription's key and its auth secret.
 */
export function encryptPayload(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, options: EncryptOptions = {}): Buffer {
  const ecdh = createECDH('prime256v1')
  if (options.asPrivate) ecdh.setPrivateKey(options.asPrivate)
  else ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const secret = ecdh.computeSecret(uaPublic)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', secret, authSecret, keyInfo, 32))
  const salt = options.salt ?? randomBytes(16)
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02: the last (and only) record, no padding.
  const record = Buffer.concat([cipher.update(plaintext), cipher.update(Buffer.from([0x02])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(21)
  Buffer.from(salt).copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header[20] = asPublic.length
  return Buffer.concat([header, asPublic, record])
}

// --- Sending ----------------------------------------------------------------------------------------

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * What became of a push: taken (`ok`), the subscription is gone (`gone`: 404, 410), too large (413),
 * too many (429), refused for another reason (`rejected`: other 4xx, a VAPID problem on this side), or
 * the push service could not be reached (`unreachable`: network, timeout, 5xx).
 */
export type PushOutcome = 'ok' | 'gone' | 'too-large' | 'rate-limited' | 'rejected' | 'unreachable'

export interface PushResult {
  outcome: PushOutcome
  /** The push service's HTTP status, if it answered. */
  status?: number
}

export interface PushSender {
  readonly publicKey: string
  send(target: PushTarget, payload: string, options: { ttl: number; urgency: PushUrgency }): Promise<PushResult>
}

export interface WebPushOptions {
  keys: VapidKeys
  /** `sub` of the VAPID token: how the push service reaches the operator (`mailto:` or `https:`). */
  subject: string
  /** Tests answer here instead of a push service. */
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

export class WebPush implements PushSender {
  readonly publicKey: string
  readonly #key: KeyObject
  readonly #subject: string
  readonly #fetch: typeof fetch
  readonly #timeoutMs: number
  readonly #now: () => number
  readonly #tokens = new Map<string, { token: string; until: number }>()

  constructor(options: WebPushOptions) {
    this.publicKey = options.keys.publicKey
    this.#key = createPrivateKey({ key: Buffer.from(options.keys.privateKey, 'base64url'), format: 'der', type: 'pkcs8' })
    this.#subject = options.subject
    this.#fetch = options.fetch ?? fetch
    this.#timeoutMs = options.timeoutMs ?? 10_000
    this.#now = options.now ?? Date.now
  }

  async send(target: PushTarget, payload: string, options: { ttl: number; urgency: PushUrgency }): Promise<PushResult> {
    const uaPublic = fromBase64url(target.p256dh)
    const authSecret = fromBase64url(target.auth)
    if (!uaPublic || !authSecret) return { outcome: 'gone' }
    // A copy over a plain ArrayBuffer, which fetch's types want; a few KB.
    const body = Uint8Array.from(encryptPayload(Buffer.from(payload, 'utf8'), uaPublic, authSecret))
    let response: Response
    try {
      response = await this.#fetch(target.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `vapid t=${this.#token(new URL(target.endpoint).origin)}, k=${this.publicKey}`,
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(options.ttl),
          Urgency: options.urgency,
        },
        body,
        // An endpoint is checked once (`isPushService`); a redirect would lead past that check.
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch {
      return { outcome: 'unreachable' }
    }
    await response.body?.cancel().catch(() => undefined)
    const { status } = response
    if (status >= 200 && status < 300) return { outcome: 'ok', status }
    if (status === 404 || status === 410) return { outcome: 'gone', status }
    if (status === 413) return { outcome: 'too-large', status }
    if (status === 429) return { outcome: 'rate-limited', status }
    if (status >= 500) return { outcome: 'unreachable', status }
    return { outcome: 'rejected', status }
  }

  #token(audience: string): string {
    const now = this.#now()
    const cached = this.#tokens.get(audience)
    if (cached && cached.until > now) return cached.token
    const token = vapidToken(audience, this.#subject, this.#key, now)
    this.#tokens.set(audience, { token, until: now + TOKEN_REUSE_MS })
    return token
  }
}
