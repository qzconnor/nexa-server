import { describe, expect, it } from 'vitest'
import { exportPublicKey, fromBase64url, isPublicKey, signAuth, toBase64url, verifyAuth } from './auth.ts'

function signPair() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
}

describe('base64url', () => {
  it('round-trips every length', () => {
    for (let length = 0; length < 70; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length))
      const text = toBase64url(bytes)
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(fromBase64url(text)).toEqual(bytes)
    }
  })

  it('rejects other alphabets and impossible lengths', () => {
    expect(fromBase64url('ab+/')).toBeNull()
    expect(fromBase64url('abc=')).toBeNull()
    expect(fromBase64url('abcde')).toBeNull()
  })
})

describe('public keys', () => {
  it('accepts raw P-256 keys for both uses', async () => {
    const sign = await signPair()
    const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    expect(await isPublicKey(await exportPublicKey(sign.publicKey), 'sign')).toBe(true)
    expect(await isPublicKey(await exportPublicKey(dh.publicKey), 'dh')).toBe(true)
  })

  it('rejects garbage and points off the curve', async () => {
    expect(await isPublicKey('AAAA', 'sign')).toBe(false)
    const offCurve = new Uint8Array(65)
    offCurve[0] = 4
    offCurve[64] = 1
    expect(await isPublicKey(toBase64url(offCurve), 'sign')).toBe(false)
  })
})

describe('login signature', () => {
  it('verifies for the right key and nonce only', async () => {
    const pair = await signPair()
    const other = await signPair()
    const signKey = await exportPublicKey(pair.publicKey)
    const sig = await signAuth(pair.privateKey, 'nonce-1')
    expect(await verifyAuth(signKey, 'nonce-1', sig)).toBe(true)
    expect(await verifyAuth(signKey, 'nonce-2', sig)).toBe(false)
    expect(await verifyAuth(await exportPublicKey(other.publicKey), 'nonce-1', sig)).toBe(false)
    expect(await verifyAuth(signKey, 'nonce-1', 'AAAA')).toBe(false)
  })
})
