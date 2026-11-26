/**
 * Who belongs to the namespace in a device's own eyes, and which namespace keys it holds. The server's
 * list of instances is only a claim (it could add one of its own), so each device keeps its own list
 * of members: those that showed they hold the namespace's key (`member.hello`) and the keys the server
 * listed for them. New namespace keys go to members only (docs/NEXA-SERVER.md, „Mitglieder“).
 */

import { fromBase64url } from './auth'
import { NAMESPACE_KEY_BYTES } from './envelope'
import { isInstanceId, type InstanceInfo } from './protocol'

/** `kind`s of the messages devices send each other; the server sees them in plain text. */
export const MessageKind = {
  /**
   * „I am this instance, with these keys“, sealed with the namespace's key: to all after login, to one
   * device that isn't a member yet now and then, and back to whoever sent one (then marked `reply`).
   */
  hello: 'member.hello',
  /** A namespace key and the members it is for, sealed with the pairwise key; to one member. */
  keyShare: 'key.share',
} as const

/** A device that showed it holds the namespace's key, with the keys the server listed for it then. */
export interface Member {
  id: string
  signKey: string
  dhKey: string
  /** When this device took it in. */
  since: number
}

/** A namespace key. `raw` is the secret; it is stored encrypted and only goes out in a pairing code or `key.share`. */
export interface KeyRecord {
  /** Counts up with every change of key; orders keys across devices. */
  gen: number
  /** `keyIdOf(raw)`: tells keys apart in a message without giving them away. */
  id: string
  raw: string
  createdAt: number
}

/** Keys kept: the newest and a few before it, to understand devices that missed a change. */
export const KEPT_KEYS = 4

/**
 * Order of keys, newest first: the higher generation; at the same generation (two devices changed the
 * key at the same moment) the lower id, so every device settles on the same one.
 */
export function compareKeys(a: Pick<KeyRecord, 'gen' | 'id'>, b: Pick<KeyRecord, 'gen' | 'id'>): number {
  if (a.gen !== b.gen) return b.gen - a.gen
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The keys to keep, newest first, without duplicates. */
export function keepNewest(keys: readonly KeyRecord[], max = KEPT_KEYS): KeyRecord[] {
  const byId = new Map(keys.map((key) => [key.id, key]))
  return [...byId.values()].sort(compareKeys).slice(0, max)
}

/** What `member.hello` holds. */
export interface Hello {
  instance: string
  signKey: string
  dhKey: string
  /** Answers a hello: not answered itself, so two devices don't answer each other forever. */
  reply: boolean
}

/** What `key.share` holds. */
export interface KeyShare {
  key: KeyRecord
  /** The members as the sender knows them, so a device that was away learns of removals too. */
  members: Member[]
}

const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/
/** A namespace has at most as many instances as its server allows; more members than this is junk. */
const MAX_MEMBERS = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPublicKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY.test(value)
}

export function parseHello(data: unknown): Hello | null {
  if (!isRecord(data)) return null
  const { instance, signKey, dhKey, reply } = data
  if (!isInstanceId(instance) || !isPublicKey(signKey) || !isPublicKey(dhKey)) return null
  return { instance, signKey, dhKey, reply: reply === true }
}

function parseMember(data: unknown): Member | null {
  if (!isRecord(data)) return null
  const { id, signKey, dhKey, since } = data
  if (!isInstanceId(id) || !isPublicKey(signKey) || !isPublicKey(dhKey)) return null
  if (typeof since !== 'number' || !Number.isFinite(since)) return null
  return { id, signKey, dhKey, since }
}

export function parseKeyRecord(data: unknown): KeyRecord | null {
  if (!isRecord(data)) return null
  const { gen, id, raw, createdAt } = data
  if (typeof gen !== 'number' || !Number.isSafeInteger(gen) || gen < 0) return null
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(id)) return null
  if (typeof raw !== 'string' || fromBase64url(raw)?.length !== NAMESPACE_KEY_BYTES) return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  return { gen, id, raw, createdAt }
}

export function parseKeyShare(data: unknown): KeyShare | null {
  if (!isRecord(data) || !Array.isArray(data.members) || data.members.length > MAX_MEMBERS) return null
  const key = parseKeyRecord(data.key)
  if (!key) return null
  const members: Member[] = []
  for (const entry of data.members) {
    const member = parseMember(entry)
    if (!member) return null
    members.push(member)
  }
  return { key, members }
}

/**
 * Whether a hello says the same about its sender as the server's list: the same instance and the same
 * keys. A device the server made up has keys of its own but no namespace key; one that copied a real
 * device's hello has the wrong instance.
 */
export function helloMatches(hello: Omit<Hello, 'reply'>, from: string, info: InstanceInfo | undefined): boolean {
  return !!info && info.id === from && hello.instance === from && info.signKey === hello.signKey && info.dhKey === hello.dhKey
}

/**
 * Who changes the key after a removal: the member with the lowest id among those online and this
 * device. Others wait a while and change it themselves if no new key came (`ROTATION_FALLBACK_MS`), so
 * a server that lies about who is online can delay a change but not stop it.
 */
export function rotationLeader(members: readonly Pick<Member, 'id'>[], online: ReadonlySet<string>, self: string): string {
  const candidates = members.map((member) => member.id).filter((id) => id === self || online.has(id))
  return candidates.sort()[0] ?? self
}

/** How far a message's time may be from the receiver's clock: clocks of devices differ a little. */
export const REPLAY_WINDOW_MS = 5 * 60_000

/**
 * Takes each message (sender and id) only once, and none sealed too long ago or too far ahead. The ids
 * stay as long as a message could still be inside the window, so memory stays small. A replay right
 * after the app restarted, of a message from before, still passes inside the window; the server could
 * only send what a device sent anyway.
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>()

  constructor(private readonly windowMs = REPLAY_WINDOW_MS) {}

  accept(from: string, id: string, at: number, now = Date.now()): boolean {
    if (Math.abs(now - at) > this.windowMs) return false
    this.prune(now)
    const key = `${from} ${id}`
    if (this.seen.has(key)) return false
    this.seen.set(key, now)
    return true
  }

  /** A message is in the window for at most twice its width (sealed ahead of the clock, then late). */
  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at <= 2 * this.windowMs) break
      this.seen.delete(key)
    }
  }
}
