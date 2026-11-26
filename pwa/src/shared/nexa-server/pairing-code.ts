/**
 * Addresses of a nexa-server and the pairing code a paired device shows for the next one:
 * `nexa1:` + base64url of UTF-8 JSON `{ u, c, k, g }` (nexa-server's docs/PROTOCOL.md, „Kopplungscode“).
 * Only devices read the code; the server never sees it, since it holds the namespace's key.
 */

import { fromBase64url, toBase64url } from './auth'
import { NAMESPACE_KEY_BYTES } from './envelope'

export const PAIRING_PREFIX = 'nexa1:'

export interface PairingCode {
  /** The server's address as `normalizeServerUrl` returns it. */
  url: string
  /** The invite for `POST /v1/join`. */
  invite: string
  /** The namespace's key, raw, base64url. */
  key: string
  /**
   * The key's generation (`g`, Nexa's own field; the protocol lets clients add fields). Without it a key
   * from the code could not be ordered against one a device made after the code was shown.
   */
  gen: number
}

/** Hosts where plain http is fine: the server on this computer, e.g. while developing it. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The address as Nexa keeps it: with `https://` when none was typed, without a trailing slash, query or
 * fragment. A path stays, for a server behind a proxy under one. Plain http only for this computer: the
 * invite and every message would cross the network readable otherwise.
 */
export function normalizeServerUrl(input: string): { url: string } | { error: string } {
  const text = input.trim()
  if (!text) return { error: 'Gib die Adresse des Servers ein.' }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return { error: 'Das ist keine gültige Adresse.' }
  }
  if (url.username || url.password) return { error: 'Die Adresse darf keinen Benutzernamen und kein Passwort enthalten.' }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    return { error: 'Der Server braucht HTTPS. Ohne geht nur ein Server auf diesem Rechner (localhost).' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Die Adresse muss mit https:// beginnen.' }
  return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` }
}

/** Where the server takes the WebSocket: the same address with `wss://` and `/v1/ws`. */
export function webSocketUrl(url: string): string {
  return `${url.replace(/^http/, 'ws')}/v1/ws`
}

export function isPairingCode(text: string): boolean {
  return text.trim().toLowerCase().startsWith(PAIRING_PREFIX)
}

export function encodePairingCode(code: PairingCode): string {
  const json = JSON.stringify({ u: code.url, c: code.invite, k: code.key, g: code.gen })
  return PAIRING_PREFIX + toBase64url(new TextEncoder().encode(json))
}

/** Null for anything that is not a complete, valid code. Unknown fields are ignored, as the protocol asks. */
export function decodePairingCode(text: string): PairingCode | null {
  const trimmed = text.trim()
  if (!isPairingCode(trimmed)) return null
  const bytes = fromBase64url(trimmed.slice(PAIRING_PREFIX.length).replace(/\s+/g, ''))
  if (!bytes) return null
  let data: unknown
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const { u, c, k, g } = data as Record<string, unknown>
  if (typeof u !== 'string' || typeof c !== 'string' || typeof k !== 'string') return null
  const url = normalizeServerUrl(u)
  if ('error' in url) return null
  if (c.trim().length === 0 || c.length > 64) return null
  if (fromBase64url(k)?.length !== NAMESPACE_KEY_BYTES) return null
  const gen = g === undefined ? 0 : g
  if (typeof gen !== 'number' || !Number.isSafeInteger(gen) || gen < 0) return null
  return { url: url.url, invite: c.trim(), key: k, gen }
}
