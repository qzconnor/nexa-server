/**
 * Keys and login signatures over WebCrypto only. Node and browsers both have `crypto.subtle`, so this file
 * works unchanged in the desktop app and the PWA as well (signing there, verifying here).
 */

import { authPayload } from './protocol.ts'

/** WebCrypto's key type, spelled so that it resolves with Node's types as well as with the DOM's. */
export type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const SIGNATURE = { name: 'ECDSA', hash: 'SHA-256' } as const
/** Uncompressed P-256 point: 0x04 ‖ x ‖ y. One accepted form keeps keys comparable byte for byte. */
const RAW_PUBLIC_KEY_LENGTH = 65

export function toBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Null for anything that is not strict base64url without padding. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export type KeyUse = 'sign' | 'dh'

/** Imports a public key as the server stores it; null if it is not a valid point on P-256. */
export async function importPublicKey(encoded: string, use: KeyUse): Promise<Key | null> {
  const raw = fromBase64url(encoded)
  if (!raw || raw.length !== RAW_PUBLIC_KEY_LENGTH || raw[0] !== 0x04) return null
  try {
    return use === 'sign'
      ? await crypto.subtle.importKey('raw', raw, ECDSA, true, ['verify'])
      : await crypto.subtle.importKey('raw', raw, ECDH, true, [])
  } catch {
    return null
  }
}

export async function isPublicKey(encoded: string, use: KeyUse): Promise<boolean> {
  return (await importPublicKey(encoded, use)) !== null
}

export async function exportPublicKey(key: Key): Promise<string> {
  return toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
}

/** Client side: the `sig` of `auth` for the nonce of `hello`. */
export async function signAuth(privateKey: Key, nonce: string): Promise<string> {
  return toBase64url(new Uint8Array(await crypto.subtle.sign(SIGNATURE, privateKey, authPayload(nonce))))
}

/** Server side: whether `sig` was made by the private half of `signKey` for this nonce. */
export async function verifyAuth(signKey: string, nonce: string, sig: string): Promise<boolean> {
  const key = await importPublicKey(signKey, 'sign')
  const signature = fromBase64url(sig)
  if (!key || !signature) return false
  try {
    return await crypto.subtle.verify(SIGNATURE, key, signature, authPayload(nonce))
  } catch {
    return false
  }
}
