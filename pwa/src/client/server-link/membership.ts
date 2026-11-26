import type { Key } from '@shared/nexa-server/auth'
import {
  importNamespaceKey,
  keyIdOf,
  openSealed,
  pairwiseKey,
  PAIRWISE,
  parseSealed,
  randomMessageId,
  randomNamespaceKey,
  seal,
  verifyOpened,
  type Header,
} from '@shared/nexa-server/envelope'
import {
  compareKeys,
  helloMatches,
  keepNewest,
  MessageKind,
  parseHello,
  parseKeyShare,
  REPLAY_WINDOW_MS,
  ReplayGuard,
  rotationLeader,
  type Hello,
  type KeyRecord,
  type Member,
} from '@shared/nexa-server/members'
import { BROADCAST, type InstanceInfo, type RelayedMessage } from '@shared/nexa-server/protocol'
import type { DeviceIssue } from '@shared/server-link'
import type { Identity } from './link-store'

/** How long a device that isn't the leader waits for a new key after a removal before it makes one. */
export const ROTATION_FALLBACK_MS = 20_000
const ROTATION_JITTER_MS = 10_000
/**
 * A device the server lists online that isn't a member yet gets a hello of its own after this, then
 * after twice as long each time up to `HELLO_RETRY_MAX_MS`: its hello may have been dropped, e.g. for a
 * wrong clock that is right by now. A device that never answers costs a message every quarter hour.
 */
export const HELLO_RETRY_MS = 30_000
const HELLO_RETRY_MAX_MS = 15 * 60_000

export interface MembershipDeps {
  instance: string
  identity: Identity
  keys: KeyRecord[]
  members: Member[]
  /** Relays a sealed body; false when not connected. */
  send(to: string, kind: string, id: string, body: unknown): boolean
  /** Members or keys changed: to be stored. */
  persist(): void
  /** What the window shows changed (trust of a device, or why it isn't trusted). */
  changed(): void
  /** This device's clock minus the server's, to tell whose clock is wrong; only shown, never trusted. */
  clockSkew?: () => number | null
  now?: () => number
  log?: (message: string) => void
}

/**
 * This device's side of the client rules of nexa-server (its docs/PROTOCOL.md, „Hinweise für Clients“):
 *
 * 1. Members only through the namespace's key: after login a device says hello to all, sealed with the
 *    key; who opens it and finds the keys the server listed for the sender takes it in. A device the
 *    server made up can't seal one.
 * 2. Every message sealed with its header as Associated Data, signed, and taken only once (`envelope.ts`).
 * 3. The sender checked by its signature with the key stored for the member, not the server's word.
 * 4. After a removal a new key, sent to each remaining member alone (pairwise ECDH), with the members.
 *    A device that missed it says hello with the old key, and a member that has the new one shares it.
 *
 * A hello is answered once (the answer is marked `reply` and not answered), so after one of the two got
 * through, both know each other.
 */
export class Membership {
  private keys: KeyRecord[]
  private members: Member[]
  private instances = new Map<string, InstanceInfo>()
  private readonly guard = new ReplayGuard()
  private readonly namespaceKeys = new Map<string, Promise<Key>>()
  private readonly pairKeys = new Map<string, Promise<Key | null>>()
  private rotationTimer: ReturnType<typeof setTimeout> | null = null
  /** A member was removed and no newer key is there yet: nobody new is taken in meanwhile. */
  private rotationPending = false
  /** Devices to say hello to again (`HELLO_RETRY_MS`), with the wait before it. */
  private readonly asks = new Map<string, { timer: ReturnType<typeof setTimeout>; delay: number }>()
  /** Why the last hello of a device didn't count, for the window. */
  private readonly issues = new Map<string, DeviceIssue>()
  private disposed = false
  private queue: Promise<void> = Promise.resolve()
  private readonly now: () => number

  constructor(private readonly deps: MembershipDeps) {
    this.keys = keepNewest(deps.keys)
    this.members = deps.members.some((m) => m.id === deps.instance)
      ? [...deps.members]
      : [...deps.members, { id: deps.instance, signKey: deps.identity.signKey, dhKey: deps.identity.dhKey, since: (deps.now ?? Date.now)() }]
    this.now = deps.now ?? Date.now
  }

  get currentKey(): KeyRecord {
    return this.keys[0]
  }

  get allKeys(): KeyRecord[] {
    return [...this.keys]
  }

  get allMembers(): Member[] {
    return [...this.members]
  }

  isMember(id: string): boolean {
    return this.members.some((m) => m.id === id)
  }

  /** Another member with the keys this device took it in with; never this device itself. */
  member(id: string): Member | undefined {
    return id === this.deps.instance ? undefined : this.members.find((m) => m.id === id)
  }

  /** Why the last hello of `id` didn't count; null once one did. */
  issueOf(id: string): DeviceIssue | null {
    return this.issues.get(id) ?? null
  }

  /** Logged in: the server's list, and hello to everyone. */
  ready(instances: readonly InstanceInfo[]): Promise<void> {
    // Right away, not in the queue: `instance` events that follow must not be overwritten by this older list.
    this.instances = new Map(instances.map((i) => [i.id, i]))
    // A new connection: whoever wasn't a member gets asked again soon, not at the pace of the last one.
    for (const id of [...this.asks.keys()]) this.cancelAsk(id)
    return this.serial(async () => {
      // Gone from the server while this device was away: removed. If the server lies, it only hides a device.
      const kept = this.members.filter((m) => m.id === this.deps.instance || this.instances.has(m.id))
      if (kept.length !== this.members.length) {
        this.members = kept
        this.deps.persist()
        this.scheduleRotation()
      }
      this.deps.changed()
      await this.sayHello(BROADCAST)
      for (const id of this.instances.keys()) this.planAsk(id)
    })
  }

  /** `instance` events: the list of the server changes; who is a member changes only by hello or removal. */
  instanceChanged(info: InstanceInfo): void {
    const before = this.instances.get(info.id)
    this.instances.set(info.id, info)
    // Back online: its own hello likely comes now; if not, it gets one soon, not at the slowed-down pace.
    if (info.online && !before?.online) this.cancelAsk(info.id)
    this.planAsk(info.id)
  }

  /** Says hello to every device that isn't a member yet right away, e.g. once this device's clock is right again. */
  askAgain(): void {
    for (const info of this.instances.values()) {
      if (this.needsAsk(info.id)) this.askLater(info.id, 0)
    }
  }

  removed(id: string): Promise<void> {
    return this.serial(async () => {
      this.instances.delete(id)
      this.cancelAsk(id)
      this.issues.delete(id)
      if (id === this.deps.instance || !this.isMember(id)) return
      this.members = this.members.filter((m) => m.id !== id)
      this.deps.persist()
      this.deps.changed()
      this.scheduleRotation()
    })
  }

  receive(msg: RelayedMessage): Promise<void> {
    return this.serial(async () => {
      if (msg.kind === MessageKind.hello) await this.onHello(msg)
      else if (msg.kind === MessageKind.keyShare) await this.onKeyShare(msg)
    })
  }

  /** Resolves once everything received or started so far is through. */
  idle(): Promise<void> {
    return this.queue
  }

  dispose(): void {
    this.disposed = true
    this.clearRotation()
    for (const id of [...this.asks.keys()]) this.cancelAsk(id)
  }

  private async onHello(msg: RelayedMessage): Promise<void> {
    const sealed = parseSealed(msg.body)
    if (!sealed || sealed.k === PAIRWISE || msg.from === this.deps.instance) return
    const member = this.members.find((m) => m.id === msg.from)
    const record = this.keys.find((k) => k.id === sealed.k)
    if (!record) {
      // A key this device doesn't hold. From a member a newer one it missed: its own hello shows the
      // member which key it has, so the member can share the new one. Only to a broadcast, since the hello
      // can't be read to see whether it was an answer: two devices with keys foreign to each other would
      // answer each other forever.
      if (member && msg.to === BROADCAST) await this.sayHello(msg.from, true)
      else if (!member) this.noteIssue(msg.from, { kind: 'key' })
      return
    }
    const opened = await openSealed(header(msg), sealed, await this.namespaceKey(record))
    const hello = opened && parseHello(opened.data)
    if (!opened || !hello || hello.instance !== msg.from) return
    if (member) {
      // A member's keys never change; another pair under its id is someone else.
      if (member.signKey !== hello.signKey || member.dhKey !== hello.dhKey) return
    } else if (this.rotationPending || !helloMatches(hello, msg.from, this.instances.get(msg.from))) {
      return
    }
    if (!(await verifyOpened(opened, hello.signKey))) return
    // New members only under the newest key: an old one may be known to a removed device.
    if (!member && record.id !== this.currentKey.id) return this.noteIssue(msg.from, { kind: 'key' })
    // Signed, so the time is the sender's: worth telling the user whose clock is off.
    const offset = opened.at - this.now()
    if (Math.abs(offset) > REPLAY_WINDOW_MS) return this.noteIssue(msg.from, { kind: 'clock', skew: offset + (this.deps.clockSkew?.() ?? 0) })
    if (!this.guard.accept(msg.from, msg.id, opened.at, this.now())) return
    this.cancelAsk(msg.from)
    const hadIssue = this.issues.delete(msg.from)
    if (!member) {
      this.members.push({ id: hello.instance, signKey: hello.signKey, dhKey: hello.dhKey, since: this.now() })
      this.deps.persist()
    }
    if (!member || hadIssue) this.deps.changed()
    // Before the hello back: it is sealed with the newest key, which the other needs first.
    if (record.id !== this.currentKey.id) await this.shareKey(msg.from)
    if (!hello.reply) await this.sayHello(msg.from, true)
  }

  private async onKeyShare(msg: RelayedMessage): Promise<void> {
    const member = this.members.find((m) => m.id === msg.from)
    const sealed = parseSealed(msg.body)
    if (!member || msg.to !== this.deps.instance || sealed?.k !== PAIRWISE) return
    const key = await this.pairKey(member)
    if (!key) return
    const opened = await openSealed(header(msg), sealed, key)
    if (!opened || !(await verifyOpened(opened, member.signKey))) return
    if (!this.guard.accept(msg.from, msg.id, opened.at, this.now())) return
    const share = parseKeyShare(opened.data)
    if (!share || (await keyIdOf(share.key.raw)) !== share.key.id) return
    if (!share.members.some((m) => m.id === this.deps.instance) || !share.members.some((m) => m.id === member.id)) return

    const newer = compareKeys(share.key, this.currentKey) < 0
    // Kept even when older: another device may still seal with it, and this one should understand it.
    this.keys = keepNewest([...this.keys, share.key])
    if (newer) {
      // The sender's members replace this device's: it may have missed a removal while away.
      const self = this.members.find((m) => m.id === this.deps.instance)!
      this.members = [self, ...share.members.filter((m) => m.id !== this.deps.instance)]
      this.rotationPending = false
      this.clearRotation()
      for (const id of this.instances.keys()) this.planAsk(id)
      this.deps.changed()
    }
    this.deps.persist()
  }

  /** After a removal: the leader makes a new key at once, the others only if none comes. */
  private scheduleRotation(): void {
    this.rotationPending = true
    this.clearRotation()
    const online = new Set([...this.instances.values()].filter((i) => i.online).map((i) => i.id))
    const leader = rotationLeader(this.members, online, this.deps.instance)
    const before = this.currentKey.id
    const delay = leader === this.deps.instance ? 0 : ROTATION_FALLBACK_MS + Math.random() * ROTATION_JITTER_MS
    this.rotationTimer = setTimeout(() => {
      this.rotationTimer = null
      void this.serial(async () => {
        if (this.currentKey.id === before) await this.rotate()
      })
    }, delay)
  }

  private async rotate(): Promise<void> {
    const raw = randomNamespaceKey()
    const record: KeyRecord = { gen: this.currentKey.gen + 1, id: await keyIdOf(raw), raw, createdAt: this.now() }
    this.keys = keepNewest([...this.keys, record])
    this.rotationPending = false
    this.deps.persist()
    this.deps.log?.(`new namespace key, generation ${record.gen}`)
    for (const member of this.members) {
      if (member.id !== this.deps.instance) await this.shareKey(member.id)
    }
  }

  private async shareKey(to: string): Promise<void> {
    const member = this.members.find((m) => m.id === to)
    const key = member && (await this.pairKey(member))
    if (!key) return
    await this.sendSealed(to, MessageKind.keyShare, PAIRWISE, key, { key: this.currentKey, members: this.members })
  }

  private async sayHello(to: string, reply = false): Promise<void> {
    const record = this.currentKey
    const hello: Hello = { instance: this.deps.instance, signKey: this.deps.identity.signKey, dhKey: this.deps.identity.dhKey, reply }
    await this.sendSealed(to, MessageKind.hello, record.id, await this.namespaceKey(record), hello)
  }

  /** Online at the server and not a member: its hello may have been lost, so it gets one of ours. */
  private needsAsk(id: string): boolean {
    return id !== this.deps.instance && !!this.instances.get(id)?.online && !this.isMember(id)
  }

  private planAsk(id: string): void {
    if (!this.needsAsk(id)) this.cancelAsk(id)
    else if (!this.asks.has(id)) this.askLater(id, HELLO_RETRY_MS)
  }

  private askLater(id: string, delay: number): void {
    if (this.disposed) return
    this.cancelAsk(id)
    const timer = setTimeout(() => {
      void this.serial(async () => {
        // Cancelled or planned anew meanwhile.
        if (this.asks.get(id)?.timer !== timer) return
        this.asks.delete(id)
        if (!this.needsAsk(id)) return
        await this.sayHello(id)
        this.askLater(id, Math.min(Math.max(2 * delay, HELLO_RETRY_MS), HELLO_RETRY_MAX_MS))
      })
    }, delay)
    this.asks.set(id, { timer, delay })
  }

  private cancelAsk(id: string): void {
    const ask = this.asks.get(id)
    if (ask) clearTimeout(ask.timer)
    this.asks.delete(id)
  }

  private noteIssue(id: string, issue: DeviceIssue): void {
    const before = this.issues.get(id)
    this.issues.set(id, issue)
    // The window shows whole minutes; a few seconds more or less are no news.
    const same = before?.kind === issue.kind && (issue.kind !== 'clock' || (before.kind === 'clock' && minutes(before.skew) === minutes(issue.skew)))
    if (same) return
    this.deps.log?.(`hello from ${id} not taken: ${issue.kind === 'clock' ? `its clock is ${Math.round(issue.skew / 1000)} s off` : 'unknown or old key'}`)
    this.deps.changed()
  }

  private async sendSealed(to: string, kind: string, keyRef: string, key: Key, data: unknown): Promise<void> {
    const id = randomMessageId()
    const body = await seal({
      header: { from: this.deps.instance, to, kind, id },
      keyRef,
      key,
      data,
      signKey: this.deps.identity.signPrivate,
      now: this.now(),
    })
    this.deps.send(to, kind, id, body)
  }

  private namespaceKey(record: KeyRecord): Promise<Key> {
    let key = this.namespaceKeys.get(record.id)
    if (!key) {
      key = importNamespaceKey(record.raw)
      this.namespaceKeys.set(record.id, key)
    }
    return key
  }

  private pairKey(member: Member): Promise<Key | null> {
    // By id and key: members taken over from a key share replace the old entries.
    const cacheKey = `${member.id} ${member.dhKey}`
    let key = this.pairKeys.get(cacheKey)
    if (!key) {
      key = pairwiseKey({ id: this.deps.instance, dhPrivate: this.deps.identity.dhPrivate }, { id: member.id, dhKey: member.dhKey })
      this.pairKeys.set(cacheKey, key)
    }
    return key
  }

  private clearRotation(): void {
    if (this.rotationTimer) clearTimeout(this.rotationTimer)
    this.rotationTimer = null
  }

  /** One message at a time: the next may depend on a member or key the last one brought. */
  private serial(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((error: unknown) => {
      this.deps.log?.(`membership: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.queue = run
    return run
  }
}

function header(msg: RelayedMessage): Header {
  return { from: msg.from, to: msg.to, kind: msg.kind, id: msg.id }
}

function minutes(ms: number): number {
  return Math.round(ms / 60_000)
}
