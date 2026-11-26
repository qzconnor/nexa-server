import { randomNamespaceKey, keyIdOf } from '@shared/nexa-server/envelope'
import { describe, expect, it } from 'vitest'
import { generateIdentity, parseStoredLink, type StoredLink } from './link-store'

async function storedLink(): Promise<StoredLink> {
  const raw = randomNamespaceKey()
  return {
    version: 1,
    url: 'https://nexa.example.com',
    namespace: 'alpha',
    instance: 'AAAAAAAAAAAAAAAAAAAAAA',
    name: 'iPhone',
    identity: await generateIdentity(),
    keys: [{ gen: 1, id: await keyIdOf(raw), raw, createdAt: 1 }],
    members: [],
    devices: [],
  }
}

describe('link store', () => {
  it('makes keys that sign and derive but never leave', async () => {
    const identity = await generateIdentity()
    expect(identity.signPrivate.extractable).toBe(false)
    expect(identity.dhPrivate.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('pkcs8', identity.signPrivate)).rejects.toThrow()
    expect(identity.signKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
  })

  it('takes back a stored pairing and drops what is broken', async () => {
    const link = await storedLink()
    expect(parseStoredLink(link)).toEqual(link)
    expect(parseStoredLink({ ...link, members: [{ id: 'x' }, ...link.members] })?.members).toEqual([])
    expect(parseStoredLink(null)).toBeNull()
    expect(parseStoredLink({ ...link, version: 2 })).toBeNull()
    expect(parseStoredLink({ ...link, keys: [{ gen: 1, id: 'short', raw: 'x', createdAt: 1 }] })).toBeNull()
    expect(parseStoredLink({ ...link, identity: { ...link.identity, signPrivate: 'not a key' } })).toBeNull()
  })
})
