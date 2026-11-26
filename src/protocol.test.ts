import { describe, expect, it } from 'vitest'
import { normalizeInstanceName, parseClientMessage, parseJoinRequest } from './protocol.ts'

const parse = (value: unknown): ReturnType<typeof parseClientMessage> => parseClientMessage(JSON.stringify(value))

describe('parseClientMessage', () => {
  it('reads auth', () => {
    expect(parse({ t: 'auth', instance: 'abc_-1', sig: 'c2ln' })).toEqual({
      ok: true,
      msg: { t: 'auth', instance: 'abc_-1', sig: 'c2ln' },
    })
    expect(parse({ t: 'auth', instance: 'a b', sig: 'c2ln' }).ok).toBe(false)
    expect(parse({ t: 'auth', instance: 'abc', sig: 'not base64!' }).ok).toBe(false)
  })

  it('reads send and keeps only the known fields', () => {
    const result = parse({ t: 'send', id: '1', to: 'abc', kind: 'rc.request', body: { x: [1] }, extra: 'dropped' })
    expect(result).toEqual({ ok: true, msg: { t: 'send', id: '1', to: 'abc', kind: 'rc.request', body: { x: [1] } } })
    expect(parse({ t: 'send', id: '1', to: '*', kind: 'k' })).toEqual({
      ok: true,
      msg: { t: 'send', id: '1', to: '*', kind: 'k' },
    })
  })

  it('rejects a send without a valid target or kind, with the id to answer', () => {
    expect(parse({ t: 'send', id: '7', to: '', kind: 'k' })).toMatchObject({ ok: false, re: '7' })
    expect(parse({ t: 'send', id: '7', to: 'abc', kind: '' })).toMatchObject({ ok: false, re: '7' })
    expect(parse({ t: 'send', id: '7', to: 'abc', kind: '-x' })).toMatchObject({ ok: false, re: '7' })
  })

  it('requires an id on requests', () => {
    expect(parse({ t: 'instances' })).toMatchObject({ ok: false, re: undefined })
    expect(parse({ t: 'instances', id: '' })).toMatchObject({ ok: false })
    expect(parse({ t: 'instances', id: 'x'.repeat(129) })).toMatchObject({ ok: false })
    expect(parse({ t: 'instances', id: 'r1' })).toEqual({ ok: true, msg: { t: 'instances', id: 'r1' } })
    expect(parse({ t: 'invite', id: 'r2' })).toEqual({ ok: true, msg: { t: 'invite', id: 'r2' } })
  })

  it('reads remove and rename', () => {
    expect(parse({ t: 'remove', id: '1', instance: 'abc' })).toEqual({
      ok: true,
      msg: { t: 'remove', id: '1', instance: 'abc' },
    })
    expect(parse({ t: 'remove', id: '1' }).ok).toBe(false)
    expect(parse({ t: 'rename', id: '1', name: '  Mein   Laptop ' })).toEqual({
      ok: true,
      msg: { t: 'rename', id: '1', name: 'Mein Laptop' },
    })
    expect(parse({ t: 'rename', id: '1', instance: 'abc', name: 'X' })).toEqual({
      ok: true,
      msg: { t: 'rename', id: '1', instance: 'abc', name: 'X' },
    })
    expect(parse({ t: 'rename', id: '1', name: '' }).ok).toBe(false)
  })

  it('rejects junk', () => {
    expect(parseClientMessage('{').ok).toBe(false)
    expect(parse([1, 2]).ok).toBe(false)
    expect(parse(null).ok).toBe(false)
    expect(parse({ id: '1' }).ok).toBe(false)
    expect(parse({ t: 'bogus', id: '1' })).toMatchObject({ ok: false, re: '1' })
  })
})

describe('normalizeInstanceName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeInstanceName(' Desktop\t im  Büro\n')).toBe('Desktop im Büro')
    expect(normalizeInstanceName('💻 Laptop')).toBe('💻 Laptop')
  })

  it('rejects empty, long and spoofing names', () => {
    expect(normalizeInstanceName('   ')).toBeNull()
    expect(normalizeInstanceName('x'.repeat(65))).toBeNull()
    expect(normalizeInstanceName('abc‮fdp.exe')).toBeNull()
    expect(normalizeInstanceName('a\u0000b')).toBeNull()
    expect(normalizeInstanceName(42)).toBeNull()
  })
})

describe('parseJoinRequest', () => {
  const valid = { invite: 'ABCD', name: 'Desktop', role: 'host', signKey: 'AAAA', dhKey: 'BBBB' }

  it('accepts a complete join', () => {
    expect(parseJoinRequest(valid)).toEqual({ ok: true, value: valid })
  })

  it('names the field that is wrong', () => {
    expect(parseJoinRequest({ ...valid, role: 'admin' })).toMatchObject({ ok: false, message: expect.stringMatching(/^role/) })
    expect(parseJoinRequest({ ...valid, name: '' })).toMatchObject({ ok: false, message: expect.stringMatching(/^name/) })
    expect(parseJoinRequest({ ...valid, signKey: 'a+b' })).toMatchObject({ ok: false, message: expect.stringMatching(/^signKey/) })
    expect(parseJoinRequest({ ...valid, invite: undefined })).toMatchObject({ ok: false, message: expect.stringMatching(/^invite/) })
    expect(parseJoinRequest('x')).toMatchObject({ ok: false })
  })
})
