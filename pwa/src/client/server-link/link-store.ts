/**
 * The pairing of this browser with its nexa-server, in IndexedDB; the web app's own counterpart of the
 * desktop's link-store.ts, whose `Identity` the client files copied from the app import from here.
 *
 * The private keys are WebCrypto keys made non-extractable. IndexedDB keeps them as they are, and
 * nothing can read them out again, not even this page's own code: it can only sign and derive with
 * them. The namespace's keys are raw bytes, as the devices pass them on in a key share.
 */

import { exportPublicKey, type Key } from '@shared/nexa-server/auth'
import { parseKeyRecord, type KeyRecord, type Member } from '@shared/nexa-server/members'
import { isInstanceId, type InstanceInfo } from '@shared/nexa-server/protocol'

/** This instance's keys, ready to use. */
export interface Identity {
  signPrivate: Key
  /** Raw public key, base64url, as the server lists it. */
  signKey: string
  dhPrivate: Key
  dhKey: string
}

export interface StoredLink {
  version: 1
  /** The server's address (`normalizeServerUrl`), this page's own origin. */
  url: string
  namespace: string
  instance: string
  name: string
  identity: Identity
  /** The namespace's keys, the newest first. */
  keys: KeyRecord[]
  members: Member[]
  /** The devices as the server listed them last, for the list while offline. */
  devices: InstanceInfo[]
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

/** New keys for this browser: one pair to log in and sign, one for ECDH; the private halves never leave it. */
export async function generateIdentity(): Promise<Identity> {
  const sign = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify'])
  const dh = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
  return {
    signPrivate: sign.privateKey,
    signKey: await exportPublicKey(sign.publicKey),
    dhPrivate: dh.privateKey,
    dhKey: await exportPublicKey(dh.publicKey),
  }
}

/** What IndexedDB gave back, checked; null for anything that can't be a pairing (e.g. from an older version). */
export function parseStoredLink(value: unknown): StoredLink | null {
  if (typeof value !== 'object' || value === null) return null
  const link = value as Partial<StoredLink>
  const identity = link.identity as Partial<Identity> | undefined
  if (link.version !== 1 || typeof link.url !== 'string' || typeof link.namespace !== 'string' || typeof link.name !== 'string') return null
  if (!isInstanceId(link.instance)) return null
  if (!identity || !isPrivateKey(identity.signPrivate) || !isPrivateKey(identity.dhPrivate)) return null
  if (typeof identity.signKey !== 'string' || typeof identity.dhKey !== 'string') return null
  const keys = Array.isArray(link.keys) ? link.keys.map(parseKeyRecord).filter((key): key is KeyRecord => key !== null) : []
  if (!keys.length) return null
  return {
    version: 1,
    url: link.url,
    namespace: link.namespace,
    instance: link.instance,
    name: link.name,
    identity: identity as Identity,
    keys,
    members: Array.isArray(link.members) ? link.members.filter(isMember) : [],
    devices: Array.isArray(link.devices) ? link.devices.filter((d): d is InstanceInfo => isInstanceId((d as InstanceInfo | null)?.id)) : [],
  }
}

function isPrivateKey(value: unknown): value is Key {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey && value.type === 'private'
}

function isMember(value: unknown): value is Member {
  const member = value as Partial<Member> | null
  return isInstanceId(member?.id) && typeof member.signKey === 'string' && typeof member.dhKey === 'string' && typeof member.since === 'number'
}

/** Where the pairing is kept; `LinkStore` in the browser, something in memory for tests. */
export interface LinkStorage {
  load(): Promise<StoredLink | null>
  save(link: StoredLink): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'nexa'
const STORE = 'link'
const RECORD = 'current'

/** The one pairing of this browser (per origin, so per server). */
export class LinkStore implements LinkStorage {
  private db: Promise<IDBDatabase> | null = null

  async load(): Promise<StoredLink | null> {
    const value = await this.run<unknown>('readonly', (store) => store.get(RECORD))
    return parseStoredLink(value)
  }

  async save(link: StoredLink): Promise<void> {
    await this.run('readwrite', (store) => store.put(link, RECORD))
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.delete(RECORD))
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB'))
    })
    // A failed open (private mode of some browsers) is tried again next time.
    this.db.catch(() => (this.db = null))
    return this.db
  }

  private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open()
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = action(transaction.objectStore(STORE))
      // Done only once the transaction is: a write counts when it is on disk.
      transaction.oncomplete = () => resolve(request.result as T)
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB'))
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB'))
    })
  }
}
