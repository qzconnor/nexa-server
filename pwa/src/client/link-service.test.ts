/**
 * End to end: a real nexa-server, a computer built from the desktop's own client files (connection,
 * membership, channel), and the web app's link pairing with it as a controller, all over WebSockets
 * with WebCrypto keys.
 */

import { keyIdOf, randomNamespaceKey } from '@shared/nexa-server/envelope'
import { encodePairingCode } from '@shared/nexa-server/pairing-code'
import { pushNotice, PUSH_KIND } from '@shared/push'
import { RemoteKind, type RemoteHostInfo } from '@shared/remote'
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { silentLogger } from '../../../src/log.ts'
import { startServer, type RunningServer } from '../../../src/server.ts'
import { Store } from '../../../src/store.ts'
import { openPush, pushNotification } from '../push/open'
import { LinkService } from './link-service'
import { RemoteClient } from './remote/remote-client'
import { ServerConnection } from './server-link/connection'
import { DeviceChannel } from './server-link/device-channel'
import { generateIdentity, type LinkStorage, type StoredLink } from './server-link/link-store'
import { Membership } from './server-link/membership'

class MemoryStorage implements LinkStorage {
  link: StoredLink | null = null
  async load() {
    return this.link
  }
  async save(link: StoredLink) {
    this.link = link
  }
  async clear() {
    this.link = null
  }
}

let store: Store
let server: RunningServer
let pwaDir: string
/** What the server handed to the push service. */
let pushed: Buffer[]
const cleanup: (() => void | Promise<void>)[] = []

beforeEach(async () => {
  store = new Store(':memory:', { maxInstances: 5 })
  store.createNamespace('alpha')
  // With the web app, so with push; the push service is a fake that keeps what it gets.
  pwaDir = mkdtempSync(join(tmpdir(), 'nexa-pwa-'))
  writeFileSync(join(pwaDir, 'index.html'), '<!doctype html><title>Nexa</title>')
  pushed = []
  server = await startServer({
    config: { host: '127.0.0.1', port: 0, maxMessageBytes: 64 * 1024, rateLimit: 1000, pwa: true },
    store,
    log: silentLogger,
    pwaDir,
    pushFetch: async (_url, init) => {
      pushed.push(Buffer.from(init!.body as Uint8Array))
      return new Response(null, { status: 201 })
    },
  })
})

afterEach(async () => {
  for (const each of cleanup.splice(0).reverse()) await each()
  await server.close()
  store.close()
  rmSync(pwaDir, { recursive: true, force: true })
})

async function until(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const HELLO: Omit<RemoteHostInfo, 'name'> = { enabled: true, level: 'prompt', version: 'test' }

/** A computer as the desktop app is one: the first of the namespace, with its key, answering `hello`. */
async function startComputer(name = 'Desktop') {
  const identity = await generateIdentity()
  const joined = await fetch(`${server.url}/v1/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ invite: store.createInvite('alpha', 60_000).code, name, role: 'host', signKey: identity.signKey, dhKey: identity.dhKey }),
  })
  const { instance } = (await joined.json()) as { instance: string }
  const raw = randomNamespaceKey()
  const connection = new ServerConnection({ url: `${server.url.replace(/^http/, 'ws')}/v1/ws`, instance, signKey: identity.signPrivate })
  const membership = new Membership({
    instance,
    identity,
    keys: [{ gen: 1, id: await keyIdOf(raw), raw, createdAt: Date.now() }],
    members: [],
    send: (to, kind, id, body) => connection.send(to, kind, id, body),
    persist: () => undefined,
    changed: () => undefined,
  })
  const channel = new DeviceChannel({ instance, identity, member: (id) => membership.member(id), send: (to, kind, id, body) => connection.send(to, kind, id, body) })
  connection.on('ready', (ready) => void membership.ready(ready.instances))
  connection.on('instance', (event) => {
    if (event.t === 'removed') void membership.removed(event.instance)
    else membership.instanceChanged(event.instance)
  })
  connection.on('relayed', async (msg) => {
    if (!msg.kind.startsWith('rc.')) return void membership.receive(msg)
    const opened = await channel.receive(msg)
    if (opened?.kind === RemoteKind.request && (opened.data as { m?: unknown }).m === 'hello') {
      await channel.send(msg.from, RemoteKind.response, { re: opened.id, r: { name, ...HELLO } })
    }
  })
  connection.start()
  cleanup.push(() => {
    membership.dispose()
    connection.stop()
  })
  await until(() => connection.status === 'online', 'the computer to log in')
  return {
    instance,
    connection,
    membership,
    channel,
    /** What „Gerät hinzufügen“ shows. */
    async pairingCode(url = server.url): Promise<string> {
      const answer = await connection.request({ t: 'invite' })
      if (answer.t !== 'invite') throw new Error('no invite')
      return encodePairingCode({ url, invite: answer.code, key: raw, gen: 1 })
    },
  }
}

/** A browser's push subscription, and what the browser does with a push (RFC 8291) before the service worker gets it. */
function browserPush() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  return {
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test', p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    open(body: Buffer): unknown {
      const salt = body.subarray(0, 16)
      const asPublic = body.subarray(21, 21 + body[20]!)
      const record = body.subarray(21 + body[20]!)
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic])
      const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), auth, info, 32))
      const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
      const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
      const decipher = createDecipheriv('aes-128-gcm', key, nonce)
      decipher.setAuthTag(record.subarray(-16))
      const plain = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()])
      return JSON.parse(plain.subarray(0, -1).toString('utf8'))
    },
  }
}

function startLink(storage = new MemoryStorage()) {
  const link = new LinkService({ store: storage, serverUrl: server.url })
  cleanup.push(() => link['active']?.connection.stop())
  return { link, storage }
}

describe('LinkService', () => {
  it('pairs with a pairing code as a controller and becomes a member on both sides', async () => {
    const computer = await startComputer()
    const { link, storage } = startLink()
    await link.init()
    expect(link.getState().status).toBe('unpaired')

    await link.pair({ code: await computer.pairingCode(), name: 'iPhone' })
    await until(() => link.getState().devices.some((d) => d.id === computer.instance && d.trusted), 'the computer to be a member')
    const state = link.getState()
    await until(() => computer.membership.isMember(state.instance!), 'the phone to be a member at the computer')

    expect(state).toMatchObject({ status: 'online', namespace: 'alpha', name: 'iPhone', error: null })
    expect(state.devices[0]).toMatchObject({ self: true, role: 'controller', name: 'iPhone' })
    expect(store.getInstance(state.instance!)?.role).toBe('controller')
    // The private keys stay what WebCrypto made them: usable, never readable.
    expect(storage.link?.identity.signPrivate.extractable).toBe(false)
    expect(storage.link?.identity.dhPrivate.extractable).toBe(false)
  })

  it('asks a computer what it lets this device do', async () => {
    const computer = await startComputer('Werkstatt')
    const { link } = startLink()
    await link.init()
    const remote = new RemoteClient({ link: { sendToDevice: (to, kind, data) => link.sendToDevice(to, kind, data), online: () => link.online() } })
    link.on('deviceMessage', (from, kind, _id, data) => remote.onDeviceMessage(from, kind, data))
    await link.pair({ code: await computer.pairingCode(), name: 'iPhone' })
    await until(() => link.getState().devices.some((d) => d.id === computer.instance && d.trusted), 'the computer to be a member')
    await until(() => computer.membership.isMember(link.getState().instance!), 'the phone to be a member at the computer')

    expect(await remote.request(computer.instance, 'hello', {})).toEqual({ name: 'Werkstatt', ...HELLO })
  })

  it('takes only a pairing code for its own server, and each code once', async () => {
    const computer = await startComputer()
    const { link } = startLink()
    await link.init()
    await expect(link.pair({ code: store.createInvite('alpha', 60_000).code, name: 'iPhone' })).rejects.toThrow(/nexa1:/)
    await expect(link.pair({ code: 'nexa1:kaputt', name: 'iPhone' })).rejects.toThrow(/beschädigt/)
    await expect(link.pair({ code: await computer.pairingCode('https://nexa.example.com'), name: 'iPhone' })).rejects.toThrow(
      /gehört zum Server https:\/\/nexa\.example\.com/,
    )

    const code = await computer.pairingCode()
    await link.pair({ code, name: 'iPhone' })
    const { link: second } = startLink()
    await second.init()
    await expect(second.pair({ code, name: 'iPad' })).rejects.toThrow(/ungültig, schon benutzt oder abgelaufen/)
  })

  it('logs in again with what it stored', async () => {
    const computer = await startComputer()
    const first = startLink()
    await first.link.init()
    await first.link.pair({ code: await computer.pairingCode(), name: 'iPhone' })
    await until(() => first.link.getState().devices.some((d) => d.id === computer.instance && d.trusted), 'the computer to be a member')
    const instance = first.link.getState().instance
    first.link['active']?.connection.stop()

    const again = startLink(first.storage)
    await again.link.init()
    await until(() => again.link.getState().status === 'online', 'the login with the stored keys')
    await until(() => again.link.getState().devices.some((d) => d.id === computer.instance && d.trusted), 'the computer to be a member')
    expect(again.link.getState().instance).toBe(instance)
  })

  it('leaves the namespace, and forgets the pairing when another device removes it', async () => {
    const computer = await startComputer()
    const { link, storage } = startLink()
    await link.init()
    await link.pair({ code: await computer.pairingCode(), name: 'iPhone' })
    await until(() => link.getState().status === 'online', 'the login')
    const instance = link.getState().instance!
    await link.unpair()
    expect(link.getState()).toMatchObject({ status: 'unpaired', error: null })
    expect(storage.link).toBeNull()
    await until(() => !store.hasInstance(instance), 'the server to drop the phone')

    await link.pair({ code: await computer.pairingCode(), name: 'iPhone' })
    await until(() => link.getState().status === 'online', 'the login')
    await computer.connection.request({ t: 'remove', instance: link.getState().instance! })
    await until(() => link.getState().status === 'unpaired', 'the removal')
    expect(link.getState().error).toMatch(/aus dem Namespace entfernt/)
    expect(storage.link).toBeNull()
  })

  it('gets the pushes of a computer once subscribed, and opens them as the service worker does', async () => {
    const computer = await startComputer()
    const { link, storage } = startLink()
    await link.init()
    await link.pair({ code: await computer.pairingCode(), name: 'iPhone' })
    const phone = link.getState().instance!
    // The service worker reads the members from storage, as it can't ask this page.
    await until(() => storage.link?.members.some((m) => m.id === computer.instance) ?? false, 'the computer to be a member in storage')
    await until(() => computer.membership.isMember(phone), 'the phone to be a member at the computer')
    const browser = browserPush()
    await link.subscribePush(browser.subscription)

    // As the desktop app pushes (server-link-service.ts, `push`).
    const notice = pushNotice('done', 'chat_1', 'Claude ist fertig', 'Mein Chat\nAlles erledigt.')
    const sealed = (await computer.channel.sealed(phone, PUSH_KIND, notice))!
    await computer.connection.request({ t: 'push', id: sealed.id, to: phone, kind: PUSH_KIND, body: sealed.body, urgency: 'normal', ttl: 3600 })
    expect(pushed).toHaveLength(1)
    const opened = await openPush(browser.open(pushed[0]!), storage.link!)
    expect(opened).toEqual({ from: computer.instance, notice })
    expect(pushNotification(opened!, storage.link!)).toMatchObject({ tag: `${computer.instance}:chat_1`, path: `chats/${computer.instance}/chat_1` })

    await link.unsubscribePush()
    const again = { t: 'push', id: sealed.id, to: phone, kind: PUSH_KIND, body: sealed.body } as const
    await expect(computer.connection.request(again)).rejects.toMatchObject({ code: 'unsubscribed' })
  })

  it('subscribes to pushes only while connected', async () => {
    const { link } = startLink()
    await link.init()
    await expect(link.subscribePush(browserPush().subscription)).rejects.toMatchObject({ code: 'offline' })
  })
})
