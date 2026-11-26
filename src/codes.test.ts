import { describe, expect, it } from 'vitest'
import {
  encodeBase32,
  generateInviteCode,
  hashInviteCode,
  isNamespaceName,
  normalizeInviteCode,
  randomId,
} from './codes.ts'

describe('randomId', () => {
  it('is base64url of the given length', () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(randomId(32)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(randomId()).not.toBe(randomId())
  })
})

describe('encodeBase32', () => {
  it('encodes with the Crockford alphabet', () => {
    expect(encodeBase32(new Uint8Array([0, 0, 0, 0, 0]))).toBe('00000000')
    expect(encodeBase32(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe('ZZZZZZZZ')
    // "f" = 0x66 = 01100 110(00) → C, R
    expect(encodeBase32(new TextEncoder().encode('f'))).toBe('CR')
  })
})

describe('invite codes', () => {
  it('come in eight groups of four without I, L, O, U', () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('survive sloppy typing', () => {
    const code = generateInviteCode()
    const canonical = code.replace(/-/g, '')
    expect(normalizeInviteCode(code)).toBe(canonical)
    expect(normalizeInviteCode(code.toLowerCase())).toBe(canonical)
    expect(normalizeInviteCode(` ${code.replace(/-/g, ' ')} `)).toBe(canonical)
    expect(normalizeInviteCode('O'.repeat(16) + 'I'.repeat(8) + 'l'.repeat(8))).toBe('0'.repeat(16) + '1'.repeat(16))
  })

  it('reject what cannot be a code', () => {
    expect(normalizeInviteCode('ABCD')).toBeNull()
    expect(normalizeInviteCode('U'.repeat(32))).toBeNull()
    expect(normalizeInviteCode('!'.repeat(32))).toBeNull()
  })

  it('hash to the same value however they were typed', () => {
    const code = generateInviteCode()
    const hash = hashInviteCode(code)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInviteCode(code.toLowerCase().replace(/-/g, ''))).toBe(hash)
    expect(hashInviteCode('nope')).toBeNull()
  })
})

describe('isNamespaceName', () => {
  it('accepts short lowercase names', () => {
    for (const name of ['connor', 'a', 'team-1', '0', 'a'.repeat(32)]) expect(isNamespaceName(name)).toBe(true)
  })

  it('rejects everything else', () => {
    for (const name of ['', '-a', 'Connor', 'a_b', 'a b', 'ä', 'a'.repeat(33)]) expect(isNamespaceName(name)).toBe(false)
  })
})
