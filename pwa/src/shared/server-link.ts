/**
 * Pairing with a nexa-server and the devices of the namespace, as the window sees them (Einstellungen ›
 * Geräte). The connection and the encryption live in main (`main/server-link`), the protocol in
 * `shared/nexa-server`.
 */

import type { Role } from './nexa-server/protocol'
import type { RemoteLevel } from './remote'

type Unsubscribe = () => void

/**
 * `unpaired`: no server. `connecting`: logging in. `online`: connected. `offline`: lost, a new attempt
 * follows at `retryAt`. `paused`: disconnected by the user. `stopped`: the server refused this device or
 * another connection of it took over; no new attempt until the user asks (`error` says why).
 */
export type ServerLinkStatus = 'unpaired' | 'connecting' | 'online' | 'offline' | 'paused' | 'stopped'

/**
 * From this difference to the server's clock on, the window warns. Devices drop each other's messages
 * from 5 minutes apart (`REPLAY_WINDOW_MS`), so a warning at one minute comes before anything fails.
 */
export const CLOCK_SKEW_WARN_MS = 60_000

/** Why a device that said hello isn't trusted (yet). */
export type DeviceIssue =
  /** Its clock is `skew` ms ahead of the server's (behind when negative), too far for its messages to count. */
  | { kind: 'clock'; skew: number }
  /**
   * It said hello with a key this device doesn't have, or an old one: paired with the server's invite
   * instead of a pairing code, or with a code from before a change of key.
   */
  | { kind: 'key' }

/** A device of the namespace. */
export interface LinkedDevice {
  id: string
  name: string
  role: Role
  online: boolean
  lastSeen: number | null
  createdAt: number
  /** This device. */
  self: boolean
  /**
   * Has shown it holds the namespace's key. Until it has, Nexa sends it nothing: the server could have
   * put it on the list.
   */
  trusted: boolean
  /** Why its last hello didn't count; null once it does, and for trusted devices. */
  issue: DeviceIssue | null
  /** What this device lets it do by Remote Control, if turned on (`ServerLinkState.remoteEnabled`). */
  level: RemoteLevel
}

/**
 * A device with chats of its own: a computer running Nexa. A phone (the PWA, role `controller`) only
 * controls, so it isn't in the sidebar and no chat goes to it; what it may do here is still its level.
 */
export function hasChats(device: Pick<LinkedDevice, 'role'>): boolean {
  return device.role === 'host'
}

/**
 * The phones the notifications of chats go to (setting `notifications.push`): controllers that may at
 * least read along here. A push tells what happened in a chat; a device that may not see it gets none.
 */
export function pushPhones(state: Pick<ServerLinkState, 'remoteEnabled' | 'devices'>): LinkedDevice[] {
  if (!state.remoteEnabled) return []
  return state.devices.filter((d) => d.role === 'controller' && !d.self && d.trusted && d.level !== 'off')
}

export interface ServerLinkState {
  status: ServerLinkStatus
  url: string | null
  namespace: string | null
  /** This device's instance. */
  instance: string | null
  /** This device's name in the namespace. */
  name: string | null
  /** In German, for the user: why it stopped, or why it is no longer paired. */
  error: string | null
  /** Paired, but the keys no longer decrypt (another user account, a new key store): only leaving helps. */
  locked: boolean
  retryAt: number | null
  /**
   * This device's clock minus the server's in ms, measured at login; null while not connected. Only shown,
   * never trusted: the server could lie about its time.
   */
  clockSkew: number | null
  /** The other devices may control this one, each as far as its `level` says. */
  remoteEnabled: boolean
  /** As the server listed them last; while offline the last known list. */
  devices: LinkedDevice[]
  /** The name a device gets unless the user picks one: the computer's. */
  defaultName: string
}

export interface PairInput {
  /** The server's address; ignored with a pairing code, which holds it. */
  url: string
  /** The invite of the server's admin (first device) or the pairing code of a paired device (`nexa1:…`). */
  code: string
  /** This device's name in the namespace. */
  name: string
}

/** A pairing code for another device: shown once, valid until `expiresAt`. */
export interface DeviceInvite {
  code: string
  expiresAt: number
  /** The server's web app with the code (`webAppPairingLink`), for a QR code; only if the server serves it. */
  webApp?: string
}

export const ServerLinkInvoke = {
  state: 'server-link:state',
  pair: 'server-link:pair',
  invite: 'server-link:invite',
  rename: 'server-link:rename',
  remove: 'server-link:remove',
  unpair: 'server-link:unpair',
  connect: 'server-link:connect',
  disconnect: 'server-link:disconnect',
  setRemote: 'server-link:set-remote',
  setLevel: 'server-link:set-level',
} as const

export const ServerLinkEvent = {
  changed: 'event:server-link-changed',
} as const

export interface ServerLinkApi {
  state(): Promise<ServerLinkState>
  pair(input: PairInput): Promise<ServerLinkState>
  /** A pairing code for the next device; needs the connection. */
  invite(): Promise<DeviceInvite>
  /** Renames a device of the namespace, this one with `null`. */
  rename(instance: string | null, name: string): Promise<void>
  /** Removes another device; it has to pair again. The others then change the namespace's key. */
  remove(instance: string): Promise<void>
  /** Leaves the namespace: removes this device at the server (if reachable) and forgets keys and server. */
  unpair(): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Lets the other devices control this one (each as far as its level), or none. */
  setRemote(enabled: boolean): Promise<void>
  /** What another device may do here by Remote Control. */
  setLevel(instance: string, level: RemoteLevel): Promise<void>
  onChanged(cb: (state: ServerLinkState) => void): Unsubscribe
}
