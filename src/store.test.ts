import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { Store, StoreError, type NewInstance } from './store.ts'

const device = (name = 'Desktop'): NewInstance => ({ name, role: 'host', signKey: 'sign', dhKey: 'dh' })

let now: number
let store: Store

beforeEach(() => {
  now = 1_800_000_000_000
  store = new Store(':memory:', { maxInstances: 2, now: () => now })
})

function code(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    if (error instanceof StoreError) return error.code
    throw error
  }
  return undefined
}

describe('namespaces', () => {
  it('are created once with a valid name', () => {
    store.createNamespace('connor')
    expect(store.hasNamespace('connor')).toBe(true)
    expect(code(() => store.createNamespace('connor'))).toBe('namespace-exists')
    expect(code(() => store.createNamespace('Connor!'))).toBe('namespace-invalid')
    expect(store.listNamespaces()).toEqual([{ name: 'connor', createdAt: now, instances: 0 }])
  })

  it('take their instances and invites with them when deleted', () => {
    store.createNamespace('connor')
    const { code: invite } = store.createInvite('connor', 1000)
    const instance = store.redeemInvite(store.createInvite('connor', 1000).code, device())
    expect(store.deleteNamespace('connor')).toBe(true)
    expect(store.getInstance(instance.id)).toBeUndefined()
    store.createNamespace('connor')
    expect(code(() => store.redeemInvite(invite, device()))).toBe('invite-invalid')
    expect(store.deleteNamespace('nobody')).toBe(false)
  })
})

describe('invites', () => {
  beforeEach(() => store.createNamespace('connor'))

  it('need an existing namespace', () => {
    expect(code(() => store.createInvite('nobody', 1000))).toBe('namespace-unknown')
  })

  it('turn into exactly one instance', () => {
    const invite = store.createInvite('connor', 1000)
    expect(invite.expiresAt).toBe(now + 1000)
    const instance = store.redeemInvite(invite.code.toLowerCase(), device())
    expect(instance).toMatchObject({ namespace: 'connor', name: 'Desktop', role: 'host', createdAt: now, lastSeen: null })
    expect(instance.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(code(() => store.redeemInvite(invite.code, device()))).toBe('invite-invalid')
    expect(store.listInstances('connor')).toEqual([instance])
  })

  it('expire', () => {
    const invite = store.createInvite('connor', 1000)
    expect(store.countInvites('connor')).toBe(1)
    now += 1000
    expect(store.countInvites('connor')).toBe(0)
    expect(code(() => store.redeemInvite(invite.code, device()))).toBe('invite-invalid')
    expect(store.pruneInvites()).toBe(1)
  })

  it('fail alike for codes that never existed', () => {
    expect(code(() => store.redeemInvite('nonsense', device()))).toBe('invite-invalid')
    expect(code(() => store.redeemInvite('0'.repeat(32), device()))).toBe('invite-invalid')
  })

  it('stay valid when the namespace is full, and do not let in more than the limit', () => {
    store.redeemInvite(store.createInvite('connor', 1000).code, device('A'))
    store.redeemInvite(store.createInvite('connor', 1000).code, device('B'))
    const third = store.createInvite('connor', 1000)
    expect(code(() => store.redeemInvite(third.code, device('C')))).toBe('namespace-full')
    expect(store.countInvites('connor')).toBe(1)
    expect(store.listInstances('connor')).toHaveLength(2)
  })

  it('made by an instance die with it', () => {
    const creator = store.redeemInvite(store.createInvite('connor', 1000).code, device())
    const invite = store.createInvite('connor', 1000, creator.id)
    store.removeInstance(creator.id)
    expect(code(() => store.redeemInvite(invite.code, device()))).toBe('invite-invalid')
  })
})

describe('instances', () => {
  beforeEach(() => store.createNamespace('connor'))

  it('can be renamed, touched and removed', () => {
    const instance = store.redeemInvite(store.createInvite('connor', 1000).code, device())
    expect(store.hasInstance(instance.id)).toBe(true)
    expect(store.renameInstance(instance.id, 'Laptop')).toBe(true)
    now += 5000
    expect(store.touchInstance(instance.id)).toBe(true)
    expect(store.getInstance(instance.id)).toMatchObject({ name: 'Laptop', lastSeen: now })
    expect(store.getNamespace('connor')?.instances).toBe(1)
    expect(store.removeInstance(instance.id)).toBe(true)
    expect(store.hasInstance(instance.id)).toBe(false)
    expect(store.touchInstance(instance.id)).toBe(false)
    expect(store.renameInstance(instance.id, 'X')).toBe(false)
    expect(store.removeInstance(instance.id)).toBe(false)
  })
})

describe('settings and push', () => {
  beforeEach(() => store.createNamespace('connor'))

  it('keep a setting once made', () => {
    expect(store.setting('vapid', () => ({ key: 'a' }))).toEqual({ key: 'a' })
    expect(store.setting('vapid', () => ({ key: 'b' }))).toEqual({ key: 'a' })
  })

  it('keep one subscription per instance, gone with the instance', () => {
    const instance = store.redeemInvite(store.createInvite('connor', 1000).code, device())
    const first = { endpoint: 'https://fcm.googleapis.com/1', p256dh: 'k1', auth: 'a1' }
    const second = { endpoint: 'https://fcm.googleapis.com/2', p256dh: 'k2', auth: 'a2' }
    expect(store.getPushSubscription(instance.id)).toBeUndefined()
    store.setPushSubscription(instance.id, first)
    store.setPushSubscription(instance.id, second)
    expect(store.getPushSubscription(instance.id)).toEqual(second)
    // A push service dropping the old one leaves the new one alone.
    expect(store.deletePushSubscription(instance.id, first.endpoint)).toBe(false)
    expect(store.getPushSubscription(instance.id)).toEqual(second)
    store.removeInstance(instance.id)
    expect(store.getPushSubscription(instance.id)).toBeUndefined()
  })

  it('takes a database of schema 1 to schema 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexa-store-'))
    try {
      const path = join(dir, 'nexa.db')
      // Schema 1 as an older server left it: today's, without what schema 2 added.
      new Store(path, { maxInstances: 2 }).close()
      const old = new DatabaseSync(path)
      old.exec("DROP TABLE settings; DROP TABLE push_subscriptions; PRAGMA user_version = 1; INSERT INTO namespaces VALUES ('alt', 1)")
      old.close()
      const migrated = new Store(path, { maxInstances: 2 })
      expect(migrated.hasNamespace('alt')).toBe(true)
      expect(migrated.setting('x', () => 1)).toBe(1)
      migrated.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
