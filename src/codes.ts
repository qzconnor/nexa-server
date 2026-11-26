/** IDs, invite codes and names the server hands out or accepts. */

import { createHash, randomBytes } from 'node:crypto'

/** Random, URL-safe; 16 bytes are enough that nobody guesses an instance ID. */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

// Crockford's Base32 leaves out I, L, O and U, so a code read aloud or typed off a screen survives.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** 160 bits: guessing a code is hopeless even without any limit on attempts. */
const INVITE_BYTES = 20
const INVITE_LENGTH = (INVITE_BYTES * 8) / 5

export function encodeBase32(bytes: Uint8Array): string {
  let out = ''
  let value = 0
  let bits = 0
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out
}

/** A new invite code in groups of four: `ABCD-EFGH-…` (8 groups). */
export function generateInviteCode(): string {
  return encodeBase32(randomBytes(INVITE_BYTES)).match(/.{4}/g)!.join('-')
}

/**
 * The canonical form of a code as a person may have typed it: any case, with or without dashes and
 * spaces, O for 0 and I or L for 1. Null if it cannot be a code.
 */
export function normalizeInviteCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (code.length !== INVITE_LENGTH) return null
  for (const char of code) if (!CROCKFORD.includes(char)) return null
  return code
}

/** What the database keeps of a code: a stolen database must not hand out valid invites. */
export function hashInviteCode(input: string): string | null {
  const code = normalizeInviteCode(input)
  return code === null ? null : createHash('sha256').update(code).digest('hex')
}

const NAMESPACE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

export function isNamespaceName(name: string): boolean {
  return NAMESPACE_NAME.test(name)
}
