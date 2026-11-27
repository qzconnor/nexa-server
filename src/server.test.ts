/**
 * End to end: a real server on a free port, devices with WebCrypto keys and Node's global WebSocket, as
 * the desktop app and the PWA will talk to it.
 */

import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportPublicKey, signAuth, type Key } from './auth.ts'
import { ConfigError } from './config.ts'
import { silentLogger } from './log.ts'
import { CloseCode, type ServerMessage } from './protocol.ts'
import { startServer, type RunningServer, type ServerOptions } from './server.ts'
import { Store } from './store.ts'

const CONFIG: ServerOptions['config'] = {
  host: '127.0.0.1',
  port: 0,
  maxMessageBytes: 64 * 1024,
  rateLimit: 1000,
  pwa: false,
}

let store: Store
let server: RunningServer

beforeEach(async () => {
  store = new Store(':memory:', { maxInstances: 5 })
  store.createNamespace('alpha')
  store.createNamespace('beta')
  server = await startServer({ config: CONFIG, store, log: silentLogger, authTimeoutMs: 300 })
})

afterEach(async () => {
  await server.close()
  store.close()
})

// --- Helpers --------------------------------------------------------------------------------------

interface Device {
  id: string
  namespace: string
  privateKey: Key
}

async function newKeys(): Promise<{ privateKey: Key; signKey: string; dhKey: string }> {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  return {
    privateKey: sign.privateKey,
    signKey: await exportPublicKey(sign.publicKey),
    dhKey: await exportPublicKey(dh.publicKey),
  }
}

function postJoin(body: unknown, contentType = 'application/json'): Promise<Response> {
  return fetch(`${server.url}/v1/join`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function join(namespace: string, name = 'Gerät', invite?: string): Promise<Device> {
  const keys = await newKeys()
  const response = await postJoin({
    invite: invite ?? store.createInvite(namespace, 60_000).code,
    name,
    role: 'host',
    signKey: keys.signKey,
    dhKey: keys.dhKey,
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { namespace: string; instance: string }
  expect(body.namespace).toBe(namespace)
  return { id: body.instance, namespace, privateKey: keys.privateKey }
}

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>

class Client {
  readonly ws: WebSocket
  readonly closed: Promise<{ code: number; reason: string }>
  readonly inbox: ServerMessage[] = []
  #waiters: { match: (msg: ServerMessage) => boolean; resolve: (msg: ServerMessage) => void }[] = []

  constructor() {
    this.ws = new WebSocket(server.url.replace(/^http/, 'ws') + '/v1/ws')
    this.ws.addEventListener('message', (event) => this.#push(JSON.parse(event.data as string) as ServerMessage))
    this.closed = new Promise((resolve) =>
      this.ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason })),
    )
  }

  #push(msg: ServerMessage): void {
    const index = this.#waiters.findIndex((waiter) => waiter.match(msg))
    if (index === -1) this.inbox.push(msg)
    else this.#waiters.splice(index, 1)[0]!.resolve(msg)
  }

  next<T extends ServerMessage['t']>(t: T, match: (msg: Of<T>) => boolean = () => true): Promise<Of<T>> {
    const test = (msg: ServerMessage): boolean => msg.t === t && match(msg as Of<T>)
    const index = this.inbox.findIndex(test)
    if (index !== -1) return Promise.resolve(this.inbox.splice(index, 1)[0] as Of<T>)
    return new Promise((resolve, reject) => {
      const waiter = { match: test, resolve: (msg: ServerMessage) => resolve(msg as Of<T>) }
      this.#waiters.push(waiter)
      setTimeout(() => {
        this.#waiters = this.#waiters.filter((other) => other !== waiter)
        reject(new Error(`no "${t}" within 2 s`))
      }, 2000)
    })
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg))
  }

  /** A round trip: everything the server sent before its answer has arrived afterwards. */
  async sync(): Promise<void> {
    const id = `sync-${Math.random()}`
    this.send({ t: 'instances', id })
    await this.next('instances', (msg) => msg.re === id)
  }
}

async function connect(device: Device, privateKey = device.privateKey): Promise<Client> {
  const client = new Client()
  const hello = await client.next('hello')
  expect(hello.v).toBe(1)
  client.send({ t: 'auth', instance: device.id, sig: await signAuth(privateKey, hello.nonce) })
  return client
}

async function online(device: Device): Promise<{ client: Client; ready: Of<'ready'> }> {
  const client = await connect(device)
  return { client, ready: await client.next('ready') }
}

// --- HTTP -----------------------------------------------------------------------------------------

describe('HTTP', () => {
  it('describes itself', async () => {
    for (const path of ['/', '/v1/info']) {
      const response = await fetch(server.url + path)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ name: 'nexa-server', protocol: 1, version: expect.any(String), pwa: false })
    }
    expect(await (await fetch(`${server.url}/health`)).json()).toEqual({ status: 'ok', connections: 0 })
  })

  it('answers unknown paths, wrong methods and preflights', async () => {
    expect((await fetch(`${server.url}/nope`)).status).toBe(404)
    const wrong = await fetch(`${server.url}/v1/join`)
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toBe('POST, OPTIONS')
    const preflight = await fetch(`${server.url}/v1/join`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('join', () => {
  it('uses an invite exactly once', async () => {
    const invite = store.createInvite('alpha', 60_000).code
    await join('alpha', 'Desktop', invite)
    const keys = await newKeys()
    const again = await postJoin({ invite, name: 'Zweiter', role: 'host', signKey: keys.signKey, dhKey: keys.dhKey })
    expect(again.status).toBe(403)
    expect(await again.json()).toMatchObject({ error: 'invite-invalid' })
  })

  it('rejects wrong invites, keys and bodies', async () => {
    const keys = await newKeys()
    const base = { invite: store.createInvite('alpha', 60_000).code, name: 'X', role: 'controller', ...keys }
    expect((await postJoin({ ...base, invite: 'ABCD-EFGH' })).status).toBe(403)
    expect((await postJoin({ ...base, signKey: 'AAAA' })).status).toBe(400)
    expect((await postJoin({ ...base, dhKey: base.signKey.slice(0, -2) + 'AA' })).status).toBe(400)
    expect((await postJoin({ ...base, role: 'admin' })).status).toBe(400)
    expect((await postJoin('{oops')).status).toBe(400)
    expect((await postJoin(base, 'text/plain')).status).toBe(415)
    expect((await postJoin({ ...base, name: 'x'.repeat(20_000) })).status).toBe(413)
    // None of the failures used up the invite.
    expect((await postJoin(base)).status).toBe(201)
  })

  it('stops at the instance limit', async () => {
    for (let i = 0; i < 5; i++) await join('alpha', `Gerät ${i}`)
    const keys = await newKeys()
    const response = await postJoin({ invite: store.createInvite('alpha', 60_000).code, name: 'Sechs', role: 'host', ...keys })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'namespace-full' })
  })
})

// --- Login ----------------------------------------------------------------------------------------

describe('login', () => {
  it('ends in ready with the instances of the namespace', async () => {
    const a = await join('alpha', 'Desktop')
    const b = await join('alpha', 'Laptop')
    await join('beta', 'Fremd')
    const { ready } = await online(a)
    expect(ready).toMatchObject({ t: 'ready', instance: a.id, namespace: 'alpha' })
    expect(ready.instances.map((i) => [i.id, i.name, i.online])).toEqual([
      [a.id, 'Desktop', true],
      [b.id, 'Laptop', false],
    ])
    expect(ready.instances[0]).toMatchObject({ role: 'host', signKey: expect.any(String), dhKey: expect.any(String) })
  })

  it('announces the configured limits in ready', async () => {
    const { ready } = await online(await join('alpha'))
    expect(ready.limits).toEqual({ maxMessageBytes: 64 * 1024, rateLimit: 1000 })

    await server.close()
    server = await startServer({ config: { ...CONFIG, maxMessageBytes: 4096, rateLimit: 7 }, store, log: silentLogger })
    const { ready: other } = await online(await join('alpha'))
    expect(other.limits).toEqual({ maxMessageBytes: 4096, rateLimit: 7 })
  })

  it('closes with 4401 on a wrong signature', async () => {
    const a = await join('alpha')
    const client = await connect(a, (await newKeys()).privateKey)
    expect((await client.closed).code).toBe(CloseCode.AuthFailed)
  })

  it('closes with 4401 without auth in time or with anything else first', async () => {
    const silent = new Client()
    await silent.next('hello')
    expect((await silent.closed).code).toBe(CloseCode.AuthFailed)

    const eager = new Client()
    await eager.next('hello')
    eager.send({ t: 'instances', id: '1' })
    expect((await eager.closed).code).toBe(CloseCode.AuthFailed)
  })

  it('closes with 4403 for an instance that does not exist', async () => {
    const a = await join('alpha')
    store.removeInstance(a.id)
    const client = await connect(a)
    expect((await client.closed).code).toBe(CloseCode.Removed)
  })

  it('lets a new connection replace the old one with 4409, without going offline', async () => {
    const a = await join('alpha', 'A')
    const b = await join('alpha', 'B')
    const { client: watcher } = await online(b)
    const { client: first } = await online(a)
    await watcher.next('instance', (msg) => msg.event === 'online' && msg.instance.id === a.id)

    const { client: second, ready } = await online(a)
    expect((await first.closed).code).toBe(CloseCode.Replaced)
    expect(ready.instances.find((i) => i.id === a.id)?.online).toBe(true)

    await watcher.sync()
    expect(watcher.inbox.filter((msg) => msg.t === 'instance')).toEqual([])
    second.send({ t: 'send', id: 'm', to: b.id, kind: 'ping' })
    expect(await watcher.next('msg')).toMatchObject({ from: a.id, kind: 'ping' })
  })
})

// --- Relay ----------------------------------------------------------------------------------------

describe('relay', () => {
  it('forwards a message to one instance', async () => {
    const a = await join('alpha')
    const b = await join('alpha')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    ca.send({ t: 'send', id: 'm1', to: b.id, kind: 'rc.request', body: 'Y2lwaGVydGV4dA' })
    expect(await cb.next('msg')).toEqual({ t: 'msg', id: 'm1', from: a.id, to: b.id, kind: 'rc.request', body: 'Y2lwaGVydGV4dA' })
  })

  it('answers unreachable for an instance that is offline', async () => {
    const a = await join('alpha')
    const b = await join('alpha')
    const { client } = await online(a)
    client.send({ t: 'send', id: 'm1', to: b.id, kind: 'k', body: 1 })
    expect(await client.next('error')).toMatchObject({ re: 'm1', code: 'unreachable' })
  })

  it('broadcasts to all other instances of the namespace', async () => {
    const a = await join('alpha')
    const b1 = await join('alpha')
    const b2 = await join('alpha')
    const c = await join('beta')
    const { client: ca } = await online(a)
    const { client: cb1 } = await online(b1)
    const { client: cb2 } = await online(b2)
    const { client: cc } = await online(c)
    ca.send({ t: 'send', id: 'all', to: '*', kind: 'sync.hint', body: { n: 1 } })
    for (const client of [cb1, cb2]) {
      expect(await client.next('msg')).toEqual({ t: 'msg', id: 'all', from: a.id, to: '*', kind: 'sync.hint', body: { n: 1 } })
    }
    await ca.sync()
    await cc.sync()
    expect(ca.inbox.filter((msg) => msg.t === 'msg')).toEqual([])
    expect(cc.inbox.filter((msg) => msg.t === 'msg')).toEqual([])
  })

  it('keeps namespaces apart', async () => {
    const a = await join('alpha')
    const c = await join('beta')
    const { client: ca } = await online(a)
    const { client: cc } = await online(c)
    for (const msg of [
      { t: 'send', id: 'x1', to: c.id, kind: 'k', body: 'secret' },
      { t: 'remove', id: 'x2', instance: c.id },
      { t: 'rename', id: 'x3', instance: c.id, name: 'Übernommen' },
    ]) {
      ca.send(msg)
      expect(await ca.next('error', (e) => e.re === msg.id)).toMatchObject({ code: 'unknown-instance' })
    }
    // An instance of another namespace answers like one that never existed.
    ca.send({ t: 'send', id: 'x4', to: 'doesNotExist', kind: 'k' })
    expect(await ca.next('error', (e) => e.re === 'x4')).toMatchObject({ code: 'unknown-instance' })
    await cc.sync()
    expect(cc.inbox).toEqual([])
    expect(store.getInstance(c.id)?.name).toBe('Gerät')
  })

  it('keeps the connection on a bad request', async () => {
    const a = await join('alpha')
    const { client } = await online(a)
    client.ws.send('not json')
    expect(await client.next('error')).toMatchObject({ code: 'bad-request' })
    client.send({ t: 'send', id: 'b1', to: 'x', kind: '' })
    expect(await client.next('error')).toMatchObject({ re: 'b1', code: 'bad-request' })
    await client.sync()
  })

  it('closes with 1009 on a message above the limit', async () => {
    const a = await join('alpha')
    const { client } = await online(a)
    client.send({ t: 'send', id: 'big', to: '*', kind: 'k', body: 'x'.repeat(70 * 1024) })
    expect((await client.closed).code).toBe(1009)
  })

  it('drops messages above the rate', async () => {
    await server.close()
    server = await startServer({ config: { ...CONFIG, rateLimit: 1 }, store, log: silentLogger })
    const a = await join('alpha')
    const { client } = await online(a)
    for (let i = 0; i < 5; i++) client.send({ t: 'instances', id: `r${i}` })
    expect(await client.next('error')).toMatchObject({ code: 'rate-limited' })
  })
})

// --- Managing instances ---------------------------------------------------------------------------

describe('instances', () => {
  it('hands out invites that bring in a new device, with events for the others', async () => {
    const a = await join('alpha')
    const { client } = await online(a)
    client.send({ t: 'invite', id: 'i1' })
    const invite = await client.next('invite')
    expect(invite.re).toBe('i1')
    expect(invite.code).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    expect(invite.expiresAt - Date.now()).toBeGreaterThan(14 * 60_000)

    const phone = await join('alpha', 'Handy', invite.code)
    expect(await client.next('instance')).toMatchObject({ event: 'joined', instance: { id: phone.id, name: 'Handy', online: false } })
    const { client: cp } = await online(phone)
    expect(await client.next('instance')).toMatchObject({
      event: 'online',
      instance: { id: phone.id, online: true, lastSeen: expect.any(Number) },
    })
    cp.ws.close()
    expect(await client.next('instance')).toMatchObject({ event: 'offline', instance: { id: phone.id, online: false } })
    expect(store.getInstance(phone.id)?.lastSeen).toEqual(expect.any(Number))
  })

  it('lists them on request', async () => {
    const a = await join('alpha', 'A')
    await join('alpha', 'B')
    const { client } = await online(a)
    client.send({ t: 'instances', id: 'l' })
    expect((await client.next('instances')).instances.map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('removes one: 4403 for it, removed for the rest, and it cannot come back', async () => {
    const a = await join('alpha')
    const b = await join('alpha')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    ca.send({ t: 'remove', id: 'r1', instance: b.id })
    expect(await ca.next('ok')).toEqual({ t: 'ok', re: 'r1' })
    expect(await ca.next('removed')).toEqual({ t: 'removed', instance: b.id })
    expect((await cb.closed).code).toBe(CloseCode.Removed)
    expect(store.getInstance(b.id)).toBeUndefined()

    const again = await connect(b)
    expect((await again.closed).code).toBe(CloseCode.Removed)
    // Removed is the last word about it; no „offline“ follows.
    await ca.sync()
    expect(ca.inbox.filter((msg) => msg.t === 'instance' && msg.event === 'offline')).toEqual([])
  })

  it('lets an instance remove itself', async () => {
    const a = await join('alpha')
    const b = await join('alpha')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    cb.send({ t: 'remove', id: 'self', instance: b.id })
    expect(await cb.next('ok')).toEqual({ t: 'ok', re: 'self' })
    expect((await cb.closed).code).toBe(CloseCode.Removed)
    expect(await ca.next('removed')).toEqual({ t: 'removed', instance: b.id })
  })

  it('notices a removal by the admin at the next message', async () => {
    const a = await join('alpha')
    const b = await join('alpha')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    store.removeInstance(b.id)
    cb.send({ t: 'instances', id: 'late' })
    expect((await cb.closed).code).toBe(CloseCode.Removed)
    expect(await ca.next('removed')).toEqual({ t: 'removed', instance: b.id })
  })

  it('notices a removal by the admin when relaying to it', async () => {
    const a = await join('alpha')
    const b = await join('alpha')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    store.removeInstance(b.id)
    ca.send({ t: 'send', id: 'm', to: b.id, kind: 'k', body: 'not for you' })
    expect(await ca.next('error')).toMatchObject({ re: 'm', code: 'unknown-instance' })
    expect((await cb.closed).code).toBe(CloseCode.Removed)
    expect(cb.inbox.filter((msg) => msg.t === 'msg')).toEqual([])
  })

  it('notices a removal by the admin in the heartbeat', async () => {
    await server.close()
    server = await startServer({ config: CONFIG, store, log: silentLogger, heartbeatMs: 50 })
    const a = await join('alpha')
    const b = await join('alpha')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    store.removeInstance(b.id)
    expect((await cb.closed).code).toBe(CloseCode.Removed)
    expect(await ca.next('removed')).toEqual({ t: 'removed', instance: b.id })
  })

  it('renames one and tells everyone', async () => {
    const a = await join('alpha', 'A')
    const b = await join('alpha', 'B')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    ca.send({ t: 'rename', id: 'n1', instance: b.id, name: ' Laptop  im Büro ' })
    expect(await ca.next('ok')).toEqual({ t: 'ok', re: 'n1' })
    for (const client of [ca, cb]) {
      expect(await client.next('instance', (msg) => msg.event === 'renamed')).toMatchObject({
        instance: { id: b.id, name: 'Laptop im Büro', online: true },
      })
    }
    cb.send({ t: 'rename', id: 'n2', name: 'Selbst' })
    expect(await cb.next('ok')).toEqual({ t: 'ok', re: 'n2' })
    expect(store.getInstance(b.id)?.name).toBe('Selbst')
  })
})

describe('shutdown', () => {
  it('closes connections with 1001', async () => {
    const a = await join('alpha')
    const { client } = await online(a)
    await server.close()
    expect((await client.closed).code).toBe(1001)
    server = await startServer({ config: CONFIG, store, log: silentLogger })
  })
})

describe('web app', () => {
  const SCRIPT = `console.log(${JSON.stringify('nexa '.repeat(400))})`
  let dir: string
  let app: RunningServer

  beforeEach(async () => {
    dir = mkdtempSync(joinPath(tmpdir(), 'nexa-server-pwa-'))
    mkdirSync(joinPath(dir, 'assets'))
    writeFileSync(joinPath(dir, 'index.html'), '<!doctype html><title>Nexa</title>')
    writeFileSync(joinPath(dir, 'manifest.webmanifest'), '{"name":"Nexa"}')
    writeFileSync(joinPath(dir, 'sw.js'), 'self.addEventListener("push", () => {})')
    writeFileSync(joinPath(dir, 'assets', 'index-a1b2c3.js'), SCRIPT)
    app = await startServer({ config: { ...CONFIG, pwa: true }, store, log: silentLogger, pwaDir: dir })
  })

  afterEach(async () => {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('is not there unless switched on', async () => {
    expect((await fetch(`${server.url}/app/`)).status).toBe(404)
    expect(await (await fetch(`${app.url}/v1/info`)).json()).toMatchObject({ pwa: true })
  })

  it('refuses to start switched on but not built', async () => {
    const empty = joinPath(dir, 'assets')
    await expect(startServer({ config: { ...CONFIG, pwa: true }, store, log: silentLogger, pwaDir: empty })).rejects.toThrow(
      ConfigError,
    )
  })

  it('serves the page with a strict policy and without CORS', async () => {
    const redirect = await fetch(`${app.url}/app?x=1`, { redirect: 'manual' })
    expect(redirect.status).toBe(301)
    expect(redirect.headers.get('location')).toBe('/app/?x=1')

    const page = await fetch(`${app.url}/app/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain('<title>Nexa</title>')
    const csp = page.headers.get('content-security-policy') ?? ''
    expect(csp).toContain(`default-src 'none'`)
    expect(csp).toContain(`script-src 'self'`)
    expect(csp).toContain(`frame-ancestors 'none'`)
    expect(csp).toContain(`connect-src 'self' wss://127.0.0.1:${app.port}`)
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('cache-control')).toBe('no-cache')
    expect(page.headers.has('access-control-allow-origin')).toBe(false)
    expect((await fetch(`${app.url}/app/`, { method: 'POST' })).status).toBe(405)
  })

  it('answers routes of the app with the page, and missing files with 404', async () => {
    expect(await (await fetch(`${app.url}/app/chats/abc`)).text()).toContain('<title>Nexa</title>')
    expect((await fetch(`${app.url}/app/assets/index-old.js`)).status).toBe(404)
    expect((await fetch(`${app.url}/app/..%2fpackage.json`)).status).toBe(404)
    expect((await fetch(`${app.url}/app/%E0%A4%A`)).status).toBe(404)
  })

  it('caches assets for good, compresses them and revalidates the rest', async () => {
    const asset = await fetch(`${app.url}/app/assets/index-a1b2c3.js`, { headers: { 'accept-encoding': 'gzip' } })
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(asset.headers.get('content-encoding')).toBe('gzip')
    expect(await asset.text()).toBe(SCRIPT)

    const manifest = await fetch(`${app.url}/app/manifest.webmanifest`)
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json; charset=utf-8')
    const etag = manifest.headers.get('etag')!
    expect(etag).toMatch(/^"[\w-]+"$/)
    const again = await fetch(`${app.url}/app/manifest.webmanifest`, { headers: { 'if-none-match': `W/${etag}` } })
    expect(again.status).toBe(304)
  })

  it('serves the service worker under its fixed name, never cached for good', async () => {
    // Its name has no hash: a cached old one would keep the next version out.
    const worker = await fetch(`${app.url}/app/sw.js`)
    expect(worker.status).toBe(200)
    expect(worker.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(worker.headers.get('cache-control')).toBe('no-cache')
    expect(worker.headers.get('content-security-policy')).toContain(`worker-src 'self'`)
  })
})

// --- Push -----------------------------------------------------------------------------------------

describe('push', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/phone-1'
  let dir: string
  let pushed: { url: string; headers: Record<string, string>; body: Buffer }[]
  let status: number

  /** A phone's subscription, and what its browser does with a push (RFC 8291). */
  function phone() {
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const auth = randomBytes(16)
    return {
      subscription: { endpoint: ENDPOINT, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
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

  beforeEach(async () => {
    dir = mkdtempSync(joinPath(tmpdir(), 'nexa-server-push-'))
    writeFileSync(joinPath(dir, 'index.html'), '<!doctype html><title>Nexa</title>')
    pushed = []
    status = 201
    await server.close()
    server = await startServer({
      config: { ...CONFIG, pwa: true, vapidSubject: 'mailto:admin@example.org' },
      store,
      log: silentLogger,
      pwaDir: dir,
      pushFetch: async (url, init) => {
        pushed.push({ url: String(url), headers: init!.headers as Record<string, string>, body: Buffer.from(init!.body as Uint8Array) })
        return new Response(null, { status })
      },
    })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function subscribed() {
    const a = await join('alpha', 'Computer')
    const b = await join('alpha', 'Handy')
    const { client: ca } = await online(a)
    const { client: cb } = await online(b)
    const device = phone()
    cb.send({ t: 'push-subscribe', id: 's1', ...device.subscription })
    expect(await cb.next('ok')).toEqual({ t: 'ok', re: 's1' })
    return { a, b, ca, cb, device }
  }

  it('offers push with the web app only, with a key that stays', async () => {
    const info = (await (await fetch(`${server.url}/v1/info`)).json()) as { vapidKey?: string }
    expect(info.vapidKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    await server.close()
    server = await startServer({ config: { ...CONFIG, pwa: true }, store, log: silentLogger, pwaDir: dir })
    expect(await (await fetch(`${server.url}/v1/info`)).json()).toMatchObject({ vapidKey: info.vapidKey })
    await server.close()
    server = await startServer({ config: CONFIG, store, log: silentLogger })
    expect(await (await fetch(`${server.url}/v1/info`)).json()).not.toHaveProperty('vapidKey')
  })

  it('pushes exactly the message a send would relay, then stops after unsubscribing', async () => {
    const { a, b, ca, cb, device } = await subscribed()
    ca.send({ t: 'push', id: 'p1', to: b.id, kind: 'push.notify', body: 'c2VhbGVk', urgency: 'high', ttl: 60 })
    expect(await ca.next('ok')).toEqual({ t: 'ok', re: 'p1' })
    expect(pushed).toHaveLength(1)
    const [{ url, headers, body }] = pushed as [(typeof pushed)[number]]
    expect(url).toBe(ENDPOINT)
    expect(headers).toMatchObject({ TTL: '60', Urgency: 'high', 'Content-Encoding': 'aes128gcm' })
    const { vapidKey } = (await (await fetch(`${server.url}/v1/info`)).json()) as { vapidKey: string }
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapidKey}$`))
    expect(device.open(body)).toEqual({ t: 'msg', id: 'p1', from: a.id, to: b.id, kind: 'push.notify', body: 'c2VhbGVk' })

    ca.send({ t: 'push', id: 'p2', to: b.id, kind: 'push.notify' })
    expect(await ca.next('ok')).toEqual({ t: 'ok', re: 'p2' })
    expect(pushed[1]!.headers).toMatchObject({ TTL: '3600', Urgency: 'normal' })

    cb.send({ t: 'push-unsubscribe', id: 'u1' })
    expect(await cb.next('ok')).toEqual({ t: 'ok', re: 'u1' })
    ca.send({ t: 'push', id: 'p3', to: b.id, kind: 'push.notify' })
    expect(await ca.next('error')).toMatchObject({ re: 'p3', code: 'unsubscribed' })
    expect(pushed).toHaveLength(2)
  })

  it('takes only push services it knows and real keys', async () => {
    const a = await join('alpha')
    const { client } = await online(a)
    const { subscription } = phone()
    const tries = [
      { endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
      { endpoint: 'https://127.0.0.1/push' },
      { endpoint: 'https://example.org/push' },
      { p256dh: 'A'.repeat(87) },
      { auth: 'short' },
    ]
    for (const [i, change] of tries.entries()) {
      client.send({ t: 'push-subscribe', id: `s${i}`, ...subscription, ...change })
      expect(await client.next('error', (e) => e.re === `s${i}`)).toMatchObject({ code: 'bad-request' })
    }
    expect(store.getPushSubscription(a.id)).toBeUndefined()
  })

  it('says what the push service said, and forgets a subscription it dropped', async () => {
    const { b, ca } = await subscribed()
    for (const [code, error] of [
      [503, 'unreachable'],
      [429, 'rate-limited'],
      [413, 'too-large'],
      [403, 'internal'],
      [410, 'unsubscribed'],
    ] as const) {
      status = code
      ca.send({ t: 'push', id: `p${code}`, to: b.id, kind: 'push.notify' })
      expect(await ca.next('error', (e) => e.re === `p${code}`)).toMatchObject({ code: error })
    }
    expect(store.getPushSubscription(b.id)).toBeUndefined()
  })

  it('keeps namespaces apart, payloads small and pushes few', async () => {
    const { b, ca } = await subscribed()
    const c = await join('beta')
    store.setPushSubscription(c.id, phone().subscription)
    ca.send({ t: 'push', id: 'x1', to: c.id, kind: 'push.notify' })
    expect(await ca.next('error', (e) => e.re === 'x1')).toMatchObject({ code: 'unknown-instance' })
    ca.send({ t: 'push', id: 'x2', to: b.id, kind: 'push.notify', body: 'x'.repeat(4000) })
    expect(await ca.next('error', (e) => e.re === 'x2')).toMatchObject({ code: 'too-large' })
    ca.send({ t: 'push', id: 'x3', to: '*', kind: 'push.notify' })
    expect(await ca.next('error', (e) => e.re === 'x3')).toMatchObject({ code: 'bad-request' })
    expect(pushed).toHaveLength(0)

    // Two of the budget went above; the rest go through, then the server says stop.
    for (let i = 0; i < 28; i++) ca.send({ t: 'push', id: `r${i}`, to: b.id, kind: 'push.notify' })
    for (let i = 0; i < 28; i++) await ca.next('ok', (m) => m.re === `r${i}`)
    ca.send({ t: 'push', id: 'r-over', to: b.id, kind: 'push.notify' })
    expect(await ca.next('error', (e) => e.re === 'r-over')).toMatchObject({ code: 'rate-limited' })
  })

  it('is off without the web app', async () => {
    await server.close()
    server = await startServer({ config: CONFIG, store, log: silentLogger })
    const a = await join('alpha')
    const b = await join('alpha')
    const { client } = await online(a)
    client.send({ t: 'push-subscribe', id: 's1', ...phone().subscription })
    expect(await client.next('error', (e) => e.re === 's1')).toMatchObject({ code: 'bad-request' })
    client.send({ t: 'push', id: 'p1', to: b.id, kind: 'push.notify' })
    expect(await client.next('error', (e) => e.re === 'p1')).toMatchObject({ code: 'unsubscribed' })
  })
})
