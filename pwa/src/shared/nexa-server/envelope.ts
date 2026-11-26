/**
 * End-to-end encryption of what devices send each other through nexa-server. The server relays `body`
 * unchanged; it must neither read it nor pass it off as another message (docs/NEXA-SERVER.md,
 * „Verschlüsselung“, and „Hinweise für Clients“ in nexa-server's docs/PROTOCOL.md):
 *
 * - AES-256-GCM with the namespace's key (every device) or with a pairwise key from ECDH (exactly two).
 * - The header the server sees (`from`, `to`, `kind`, `id`) and the key's reference are the Associated
 *   Data: a body moved to another message, sender or kind no longer opens.
 * - Inside, a signature of the sender's instance key over that header and the data. Every device knows
 *   the namespace's key, and the server sets `from`; only the signature says who wrote it.
 * - Inside as well, the time it was sealed, for the receiver's replay window (`ReplayGuard`).
 *
 * WebCrypto only, like `auth.ts`, so the PWA can take this file over.
 */

import { fromBase64url, toBase64url, type Key } from './auth'

export const ENVELOPE_VERSION = 1
/** `k` of a body sealed with the pairwise key of sender and receiver. */
export const PAIRWISE = 'pair'
export const NAMESPACE_KEY_BYTES = 32

/**
 * Context strings: what one purpose signs or derives can't be taken for another. The signed text begins
 * with `["nexa/msg/v1"`, the login's with `nexa-server/auth/v1:`, so neither passes for the other.
 */
const MESSAGE_CONTEXT = 'nexa/msg/v1'
const KEY_ID_CONTEXT = 'nexa/key-id/v1:'
const PAIR_CONTEXT = 'nexa/pair/v1:'

const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const
const SIGNATURE_BYTES = 64
const IV_BYTES = 12
const KEY_ID_BYTES = 12

/** What the server sees of a message, and relays as it got it. */
export interface Header {
  from: string
  to: string
  kind: string
  id: string
}

/** `body` of a `send`. */
export interface SealedBody {
  v: typeof ENVELOPE_VERSION
  /** The namespace key's id (`keyIdOf`), or `PAIRWISE`. */
  k: string
  /** IV, 12 bytes. */
  n: string
  /** Ciphertext with GCM's tag. */
  c: string
}

/** A body that opened: the data, and what the sender's signature has to cover. */
export interface Opened {
  keyRef: string
  /** When the sender sealed it, by its clock. */
  at: number
  data: unknown
  signature: Uint8Array<ArrayBuffer>
  signed: Uint8Array<ArrayBuffer>
}

const encoder = new TextEncoder()

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** A new namespace key: 32 random bytes, base64url. */
export function randomNamespaceKey(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(NAMESPACE_KEY_BYTES)))
}

/** An id that is fresh for every message: the server and the receivers see it, so nothing guessable. */
export function randomMessageId(): string {
  return toBase64url(crypto.getRandomValues(new Uint8Array(12)))
}

/** Names a namespace key without giving it away: a hash, so devices tell keys apart in `k`. */
export async function keyIdOf(raw: string): Promise<string> {
  const bytes = fromBase64url(raw)
  if (!bytes) throw new Error('namespace key: expected base64url')
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(encoder.encode(KEY_ID_CONTEXT), bytes)))
  return toBase64url(hash.subarray(0, KEY_ID_BYTES))
}

export async function importNamespaceKey(raw: string): Promise<Key> {
  const bytes = fromBase64url(raw)
  if (bytes?.length !== NAMESPACE_KEY_BYTES) throw new Error('namespace key: expected 32 bytes')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * The key only these two instances share: ECDH of one's private and the other's public key, through
 * HKDF with both IDs, so it is bound to the pair and the same in either direction. Null when `theirs` is
 * no valid P-256 key.
 */
export async function pairwiseKey(own: { id: string; dhPrivate: Key }, theirs: { id: string; dhKey: string }): Promise<Key | null> {
  const raw = fromBase64url(theirs.dhKey)
  if (!raw || raw.length !== 65 || raw[0] !== 0x04) return null
  let publicKey: Key
  try {
    publicKey = await crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  } catch {
    return null
  }
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, own.dhPrivate, 256)
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  const ids = [own.id, theirs.id].sort()
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(`${PAIR_CONTEXT}${ids[0]}:${ids[1]}`) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function associatedData(header: Header, keyRef: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([MESSAGE_CONTEXT, header.from, header.to, header.kind, header.id, keyRef]))
}

export interface SealInput {
  header: Header
  /** The namespace key's id, or `PAIRWISE`. */
  keyRef: string
  key: Key
  data: unknown
  /** The sender's private ECDSA key, the one it logs in with. */
  signKey: Key
  now?: number
}

export async function seal(input: SealInput): Promise<SealedBody> {
  const aad = associatedData(input.header, input.keyRef)
  const json = encoder.encode(JSON.stringify({ at: input.now ?? Date.now(), d: input.data }))
  const signature = new Uint8Array(await crypto.subtle.sign(SIGNATURE, input.signKey, concat(aad, json)))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, input.key, concat(signature, json))
  return { v: ENVELOPE_VERSION, k: input.keyRef, n: toBase64url(iv), c: toBase64url(new Uint8Array(cipher)) }
}

/** The body of a relayed message if it has the shape of a sealed one; which key it needs is in `k`. */
export function parseSealed(body: unknown): SealedBody | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const { v, k, n, c } = body as Record<string, unknown>
  if (v !== ENVELOPE_VERSION || typeof k !== 'string' || typeof n !== 'string' || typeof c !== 'string') return null
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(k) || fromBase64url(n)?.length !== IV_BYTES) return null
  return { v, k, n, c }
}

/** Decrypts; null when the key, the header or the ciphertext don't fit. The signature is checked apart. */
export async function openSealed(header: Header, sealed: SealedBody, key: Key): Promise<Opened | null> {
  const iv = fromBase64url(sealed.n)
  const cipher = fromBase64url(sealed.c)
  if (!iv || !cipher) return null
  const aad = associatedData(header, sealed.k)
  let plain: Uint8Array
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, cipher))
  } catch {
    return null
  }
  if (plain.length <= SIGNATURE_BYTES) return null
  const json = plain.slice(SIGNATURE_BYTES)
  let inner: unknown
  try {
    inner = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json))
  } catch {
    return null
  }
  if (typeof inner !== 'object' || inner === null) return null
  const { at, d } = inner as { at?: unknown; d?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return { keyRef: sealed.k, at, data: d, signature: plain.slice(0, SIGNATURE_BYTES), signed: concat(aad, json) }
}

/** Whether the private half of `signKey` (raw, base64url, as the server lists it) signed `opened`. */
export async function verifyOpened(opened: Opened, signKey: string): Promise<boolean> {
  const raw = fromBase64url(signKey)
  if (!raw || raw.length !== 65 || raw[0] !== 0x04) return false
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    return await crypto.subtle.verify(SIGNATURE, key, opened.signature, opened.signed)
  } catch {
    return false
  }
}
