/**
 * Remote Control as the window sees it: the window API of other devices (their chats in the sidebar,
 * the chat window and its dock work on them as on this device's own) and the devices that control this
 * one. The protocol between the devices is in `shared/remote.ts`; main speaks it (`main/remote`).
 */

import type { RemoteBroadcast, RemoteHostInfo, RemoteLevel } from './remote'

type Unsubscribe = () => void

/** A device that watches this one now (Einstellungen › Geräte). */
export interface RemoteController {
  id: string
  name: string
  since: number
  level: RemoteLevel
}

/** A device this window shows, with the chats of it whose items it wants as they come. */
export interface RemoteWatch {
  instance: string
  ids: string[]
}

export const RemoteInvoke = {
  hello: 'remote:hello',
  invoke: 'remote:invoke',
  watch: 'remote:watch',
  uploadImage: 'remote:upload-image',
  controllers: 'remote:controllers',
  disconnect: 'remote:disconnect',
} as const

export const RemoteIpcEvent = {
  /** Window events of another device: `(instance, events)`. */
  events: 'event:remote-events',
  /** A device lost what this one watched there (it restarted, the watch ran out): read it anew. */
  resync: 'event:remote-resync',
  /** What a device says of itself and of this one's level, with each renewal of the watch. */
  info: 'event:remote-info',
  controllers: 'event:remote-controllers',
} as const

/** Errors come as the German text for the user (`remoteErrorText`). */
export interface RemoteApi {
  hello(instance: string): Promise<RemoteHostInfo>
  /** A call of the device's window API (`IpcInvoke`), answered by its handlers. */
  invoke<T = unknown>(instance: string, channel: string, args: unknown[]): Promise<T>
  /** The devices this window shows; replaces its last list. Their events come by `onEvents`. */
  watch(list: RemoteWatch[]): Promise<void>
  /** A picture of this device for a prompt there: the path it has there. */
  uploadImage(instance: string, path: string): Promise<string>
  /** The devices that watch this one now. */
  controllers(): Promise<RemoteController[]>
  /** „Trennen“: the device may do nothing here any more until its level is raised again. */
  disconnect(instance: string): Promise<void>
  onEvents(cb: (instance: string, events: RemoteBroadcast[]) => void): Unsubscribe
  onResync(cb: (instance: string) => void): Unsubscribe
  onInfo(cb: (instance: string, info: RemoteHostInfo) => void): Unsubscribe
  onControllers(cb: (controllers: RemoteController[]) => void): Unsubscribe
}
