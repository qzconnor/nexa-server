/**
 * The pairing of this browser with the nexa-server that serves it, as the web app's counterpart of the
 * desktop's server-link-service.ts: pairs with a pairing code as a controller, keeps the connection,
 * the devices and who of them is a member, and stores it all in IndexedDB. Connection, membership and
 * the channel to other devices are the desktop's own files (client/server-link), copied byte for byte.
 */

import { keyIdOf } from '@shared/nexa-server/envelope'
import type { KeyRecord } from '@shared/nexa-server/members'
import { decodePairingCode, isPairingCode, normalizeServerUrl, webSocketUrl } from '@shared/nexa-server/pairing-code'
import {
  isInstanceId,
  normalizeInstanceName,
  PROTOCOL_VERSION,
  type InstanceInfo,
  type JoinRequest,
  type RelayedMessage,
  type Role,
  type ServerLimits,
} from '@shared/nexa-server/protocol'
import { DEFAULT_SERVER_LIMITS } from '@shared/nexa-server/server-messages'
import type { DeviceIssue } from '@shared/server-link'
import { TypedEmitter } from './lib/typed-emitter'
import { ServerConnection, type ConnectionStatus, type SocketFactory, type StopReason } from './server-link/connection'
import { DeviceChannel } from './server-link/device-channel'
import { generateIdentity, LinkStore, type LinkStorage, type StoredLink } from './server-link/link-store'
import { Membership } from './server-link/membership'

/** A phone steers; the CLIs run on the computers. */
const ROLE: Role = 'controller'
const HTTP_TIMEOUT_MS = 15_000
/** Online and offline of devices come often; they reach IndexedDB in one write. */
const SAVE_DELAY_MS = 1_000

export interface LinkDevice {
  id: string
  name: string
  role: Role
  online: boolean
  lastSeen: number | null
  self: boolean
  /** A member: it showed it holds the namespace's key. Only members get and give messages. */
  trusted: boolean
  /** Why its last hello didn't count. */
  issue: DeviceIssue | null
}

export interface LinkState {
  /** `loading` until IndexedDB answered. */
  status: 'loading' | 'unpaired' | ConnectionStatus
  url: string | null
  namespace: string | null
  instance: string | null
  name: string | null
  /** This device first, then the computers, then the other controllers, each by name. */
  devices: LinkDevice[]
  /** What went wrong last, for the user. */
  error: string | null
  /** When the next attempt starts while offline. */
  retryAt: number | null
}

export interface PairInput {
  code: string
  name: string
}

export interface LinkServiceDeps {
  store?: LinkStorage
  /** The server this page came from; the pairing code must name it. */
  serverUrl?: string
  /** Developing with Vite: the page comes from Vite, the server is the one in the code. */
  anyServer?: boolean
  fetch?: typeof fetch
  socket?: SocketFactory
  log?: (message: string) => void
}

interface Active {
  link: StoredLink
  devices: Map<string, InstanceInfo>
  membership: Membership
  connection: ServerConnection
  channel: DeviceChannel
  offs: (() => void)[]
  /** The user leaves the namespace: the close that follows is no removal by someone else. */
  leaving: boolean
  /** The server's time at login and `performance.now()` then, to tell whose clock is off. */
  clock: { server: number; mono: number } | null
  limits: ServerLimits
}

type Events = {
  changed: [state: LinkState]
  /** A member sealed this for this device alone, checked; `id` is the message's. */
  deviceMessage: [from: string, kind: string, id: string, data: unknown]
  /** The server couldn't pass on a message this device sent (its id), e.g. the other one isn't connected. */
  deviceSendFailed: [id: string, code: string]
  /** Another device connected or went (as the server says), or was removed (`online` false). */
  deviceStatus: [id: string, online: boolean]
  /** Logged in (again): what was asked of others before may need asking anew. */
  connected: []
}

export class LinkService extends TypedEmitter<Events> {
  private readonly deps: LinkServiceDeps
  private readonly store: LinkStorage
  private readonly fetch: typeof fetch
  private active: Active | null = null
  private loaded = false
  private error: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()
  private forgetting: Promise<void> | null = null
  private busy = false

  constructor(deps: LinkServiceDeps = {}) {
    super()
    this.deps = deps
    this.store = deps.store ?? new LinkStore()
    this.fetch = deps.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async init(): Promise<void> {
    try {
      const link = await this.store.load()
      if (link) this.activate(link).connection.start()
    } catch (error) {
      this.error = 'Der Speicher des Browsers lässt sich nicht lesen. In einem privaten Fenster geht die Kopplung nicht.'
      this.log(`load: ${String(error)}`)
    }
    this.loaded = true
    this.changed()
  }

  getState(): LinkState {
    const base = { error: this.error, retryAt: null }
    const active = this.active
    if (!active) {
      return { ...base, status: this.loaded ? 'unpaired' : 'loading', url: null, namespace: null, instance: null, name: null, devices: [] }
    }
    const { link, connection, membership } = active
    const online = connection.status === 'online'
    return {
      ...base,
      status: connection.status,
      retryAt: connection.status === 'offline' ? connection.retryAt : null,
      url: link.url,
      namespace: link.namespace,
      instance: link.instance,
      name: link.name,
      devices: [...active.devices.values()]
        .map((d) => {
          const trusted = membership.isMember(d.id)
          return {
            id: d.id,
            name: d.name,
            role: d.role,
            online: online && (d.id === link.instance || d.online),
            lastSeen: d.lastSeen,
            self: d.id === link.instance,
            trusted,
            issue: trusted ? null : membership.issueOf(d.id),
          }
        })
        .sort((a, b) => Number(b.self) - Number(a.self) || roleOrder(a.role) - roleOrder(b.role) || a.name.localeCompare(b.name, 'de')),
    }
  }

  /**
   * Pairs this browser with the pairing code a paired device shows („Gerät hinzufügen“). Only a code:
   * the server's own invite would make this the first device of its namespace, with nothing to control.
   */
  async pair(input: PairInput): Promise<void> {
    if (this.active) throw new Error('Dieses Gerät ist schon gekoppelt. Melde es zuerst ab.')
    if (this.busy) throw new Error('Die Kopplung läuft schon.')
    this.busy = true
    try {
      const text = input.code.trim()
      if (!isPairingCode(text)) {
        throw new Error('Füge den Kopplungscode ein, den Nexa auf dem Computer unter Einstellungen › Geräte › „Gerät hinzufügen“ zeigt. Er beginnt mit „nexa1:“.')
      }
      const code = decodePairingCode(text)
      if (!code) throw new Error('Der Kopplungscode ist unvollständig oder beschädigt. Kopiere ihn noch einmal.')
      // The page may talk only to its own server (CSP), and a code for another server is a mix-up.
      if (!this.deps.anyServer && this.deps.serverUrl) {
        const own = normalizeServerUrl(this.deps.serverUrl)
        // Served over plain http from elsewhere than this computer: the code and keys would cross the network readable.
        if ('error' in own) throw new Error(own.error)
        if (own.url !== code.url) throw new Error(`Der Kopplungscode gehört zum Server ${code.url}. Öffne die Web-App dort: ${code.url}/app/`)
      }
      const name = normalizeInstanceName(input.name)
      if (name === null) throw new Error('Der Name des Geräts braucht 1 bis 64 Zeichen, ohne Steuerzeichen.')

      await this.probe(code.url)
      const identity = await generateIdentity()
      const joined = await this.join(code.url, { invite: code.invite, name, role: ROLE, signKey: identity.signKey, dhKey: identity.dhKey })
      const key: KeyRecord = { gen: code.gen, id: await keyIdOf(code.key), raw: code.key, createdAt: Date.now() }
      const link: StoredLink = {
        version: 1,
        url: code.url,
        namespace: joined.namespace,
        instance: joined.instance,
        name,
        identity,
        keys: [key],
        members: [],
        devices: [],
      }
      this.error = null
      const active = this.activate(link)
      await this.saveNow()
      // The browser may clear IndexedDB when space runs low, which would undo the pairing; ask it not to.
      void navigator.storage?.persist?.().catch(() => undefined)
      active.connection.start()
      this.changed()
    } finally {
      this.busy = false
    }
  }

  /** Leaves the namespace. Offline the server keeps this device in its list until another removes it. */
  async unpair(): Promise<void> {
    const active = this.active
    if (!active) {
      this.error = null
      this.changed()
      return
    }
    // The server closes with 4403 right after its answer, which would read as a removal by someone else.
    active.leaving = true
    if (active.connection.status === 'online') {
      try {
        await active.connection.request({ t: 'remove', instance: active.link.instance })
      } catch (error) {
        // Gone at the server already, or it doesn't answer: this device forgets it anyway.
        this.log(`unpair: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.forget(null)
  }

  /** Connects again: at once while waiting for the next attempt, or after it stopped (e.g. replaced). */
  reconnect(): void {
    const active = this.active
    if (!active) return
    this.error = null
    if (active.connection.status === 'offline') active.connection.retryNow()
    else active.connection.start()
    this.changed()
  }

  /** The page is back in front, or the network is: a dropped connection needn't wait for its next attempt. */
  retryNow(): void {
    this.active?.connection.retryNow()
  }

  online(): boolean {
    return this.active?.connection.status === 'online'
  }

  /**
   * Seals `data` for the member `to` alone and relays it: the message's id (an answer names it), or null
   * when not connected or `to` isn't a member. Throws `MessageTooLargeError`.
   */
  sendToDevice(to: string, kind: string, data: unknown): Promise<string | null> {
    const active = this.active
    if (!active || active.connection.status !== 'online') return Promise.resolve(null)
    return active.channel.send(to, kind, data)
  }

  /** What the server takes, as it said at the last login. */
  limits(): ServerLimits {
    return this.active?.limits ?? DEFAULT_SERVER_LIMITS
  }

  private activate(link: StoredLink): Active {
    const connection = new ServerConnection({
      url: webSocketUrl(link.url),
      instance: link.instance,
      signKey: link.identity.signPrivate,
      socket: this.deps.socket,
      log: this.deps.log,
    })
    const membership = new Membership({
      instance: link.instance,
      identity: link.identity,
      keys: link.keys,
      members: link.members,
      send: (to, kind, msgId, body) => connection.send(to, kind, msgId, body),
      persist: () => this.scheduleSave(),
      changed: () => this.changed(),
      clockSkew: () => clockSkew(active),
      log: this.deps.log,
    })
    const channel = new DeviceChannel({
      instance: link.instance,
      identity: link.identity,
      member: (memberId) => membership.member(memberId),
      send: (to, kind, msgId, body) => connection.send(to, kind, msgId, body),
      maxMessageBytes: () => active.limits.maxMessageBytes,
    })
    const active: Active = {
      link,
      devices: new Map(link.devices.map((d) => [d.id, d])),
      membership,
      connection,
      channel,
      offs: [],
      leaving: false,
      clock: null,
      limits: DEFAULT_SERVER_LIMITS,
    }
    active.offs.push(
      connection.on('status', () => this.changed()),
      connection.on('ready', (ready) => {
        active.devices = new Map(ready.instances.map((d) => [d.id, d]))
        active.limits = ready.limits
        const self = active.devices.get(link.instance)
        if (self) link.name = self.name
        // The server stamps this device's `lastSeen` at login, just before `ready`: its clock, give or take the trip.
        active.clock = self?.lastSeen ? { server: self.lastSeen, mono: performance.now() } : null
        this.scheduleSave()
        void membership.ready(ready.instances)
        this.changed()
        this.emit('connected')
      }),
      connection.on('relayed', (msg) => {
        if (msg.kind.startsWith('rc.')) void this.onDeviceMessage(active, msg)
        else void membership.receive(msg)
      }),
      connection.on('sendFailed', (msgId, error) => this.emit('deviceSendFailed', active.channel.messageOf(msgId), error.code)),
      connection.on('instance', (event) => {
        if (event.t === 'removed') {
          active.devices.delete(event.instance)
          void membership.removed(event.instance)
          this.emit('deviceStatus', event.instance, false)
        } else {
          const before = active.devices.get(event.instance.id)
          active.devices.set(event.instance.id, event.instance)
          membership.instanceChanged(event.instance)
          if (event.instance.id === link.instance) link.name = event.instance.name
          if (before?.online !== event.instance.online) this.emit('deviceStatus', event.instance.id, event.instance.online)
        }
        this.scheduleSave()
        this.changed()
      }),
      connection.on('stopped', (reason) => void this.onStopped(active, reason)),
    )
    this.active = active
    return active
  }

  private async onDeviceMessage(active: Active, msg: RelayedMessage): Promise<void> {
    try {
      const opened = await active.channel.receive(msg)
      if (opened && this.active === active) this.emit('deviceMessage', msg.from, opened.kind, opened.id, opened.data)
    } catch (error) {
      this.log(`device message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async onStopped(active: Active, reason: StopReason): Promise<void> {
    if (this.active !== active || reason === 'user') return
    if (reason === 'removed') {
      await this.forget(
        active.leaving ? null : 'Dieses Gerät wurde aus dem Namespace entfernt, von einem anderen Gerät oder vom Admin des Servers. Um es wieder zu verbinden, kopple es neu.',
      )
      return
    }
    this.error = stopMessage(reason)
    this.changed()
  }

  /** Drops the pairing; a second call while it runs waits for the same. */
  private forget(error: string | null): Promise<void> {
    if (this.forgetting) return this.forgetting
    const active = this.active
    if (!active) return Promise.resolve()
    this.active = null
    this.error = error
    for (const off of active.offs) off()
    active.membership.dispose()
    active.connection.stop('user')
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.forgetting = this.saving
      .catch(() => undefined)
      .then(() => this.store.clear())
      .finally(() => {
        this.forgetting = null
        this.changed()
      })
    return this.forgetting
  }

  /** Whether a nexa-server with this protocol answers at `url`. */
  private async probe(url: string): Promise<void> {
    let response: Response
    try {
      response = await this.fetch(`${url}/v1/info`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), cache: 'no-store' })
    } catch {
      throw new Error('Der Server ist nicht erreichbar. Ist das Handy online?')
    }
    const info = (await response.json().catch(() => null)) as { name?: unknown; protocol?: unknown } | null
    if (!response.ok || info?.name !== 'nexa-server') throw new Error('Unter dieser Adresse antwortet kein nexa-server.')
    if (info.protocol !== PROTOCOL_VERSION) {
      const newer = typeof info.protocol === 'number' && info.protocol > PROTOCOL_VERSION
      throw new Error(`Der Server spricht eine andere Version des Protokolls. ${newer ? 'Lade die Web-App neu.' : 'Der Server braucht ein Update.'}`)
    }
  }

  private async join(url: string, request: JoinRequest): Promise<{ namespace: string; instance: string }> {
    let response: Response
    try {
      response = await this.fetch(`${url}/v1/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
    } catch {
      throw new Error('Der Server ist nicht erreichbar. Ist das Handy online?')
    }
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (response.status === 201 && data && typeof data.namespace === 'string' && isInstanceId(data.instance)) {
      return { namespace: data.namespace, instance: data.instance }
    }
    throw new Error(joinMessage(typeof data?.error === 'string' ? data.error : null, response.status))
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveNow().catch((error: unknown) => this.log(`save: ${error instanceof Error ? error.message : String(error)}`))
    }, SAVE_DELAY_MS)
  }

  /** Writes the pairing now; one write after the other, so the newest state is the last. */
  private saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const active = this.active
    if (!active) return this.saving
    const link: StoredLink = {
      ...active.link,
      keys: active.membership.allKeys,
      members: active.membership.allMembers,
      devices: [...active.devices.values()],
    }
    const next = this.saving.catch(() => undefined).then(() => (this.active === active ? this.store.save(link) : undefined))
    this.saving = next
    return next
  }

  private changed(): void {
    this.emit('changed', this.getState())
  }

  private log(message: string): void {
    this.deps.log?.(message)
  }
}

/** This device's clock minus the server's now, from the time the server gave at login. */
function clockSkew(active: Active): number | null {
  const clock = active.clock
  return clock ? Date.now() - (clock.server + performance.now() - clock.mono) : null
}

function roleOrder(role: Role): number {
  return role === 'host' ? 0 : 1
}

function stopMessage(reason: Exclude<StopReason, 'user' | 'removed'>): string {
  switch (reason) {
    case 'auth-failed':
      return 'Der Server hat die Anmeldung dieses Geräts abgelehnt. Kennt er es noch? Sonst melde es ab und kopple es neu.'
    case 'replaced':
      return 'Diese Kopplung ist in einem anderen Tab oder Fenster verbunden. „Neu verbinden“ holt sie hierher.'
    case 'protocol':
      return 'Der Server spricht eine andere Version des Protokolls. Lade die Web-App neu.'
  }
}

function joinMessage(code: string | null, status: number): string {
  switch (code) {
    case 'invite-invalid':
      return 'Der Kopplungscode ist ungültig, schon benutzt oder abgelaufen (er gilt 15 Minuten). Lass dir in Nexa einen neuen zeigen.'
    case 'namespace-full':
      return 'Im Namespace sind schon so viele Geräte, wie der Server erlaubt. Entferne erst eins.'
    case 'bad-request':
      return 'Der Server hat die Kopplung abgelehnt (ungültige Anfrage).'
    default:
      return `Die Kopplung ist fehlgeschlagen (HTTP ${status}).`
  }
}
