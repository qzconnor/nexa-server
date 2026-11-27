// The PWA of nexa-server copies this file byte for byte: no Node APIs, no new relative imports
// (../server-link/pwa-copies.test.ts).
import {
  applyDiff,
  parseRemoteEvents,
  parseRemoteResponse,
  remoteErrorText,
  RemoteKind,
  WATCH_RENEW_MS,
  type RemoteBroadcast,
  type RemoteErrorBody,
  type RemoteErrorCode,
  type RemoteHostInfo,
  type RemoteMethod,
  type RemoteMethods,
} from '@shared/remote'
import type { RemoteWatch } from '@shared/remote-ipc'
import { TypedEmitter } from '../lib/typed-emitter'
import { MessageTooLargeError } from '../server-link/device-channel'

/** How long an answer may take: the host may first read a long chat from disk (`sessions:open`). */
const REQUEST_TIMEOUT_MS = 30_000
/** Refusals of the server kept for requests that don't wait yet; they come right after the send. */
const EARLY_KEPT = 64

/** What the server's refusal (`busy`, `unknown-instance`, else `unreachable`) means for a request. */
function sendFailure(code: string): RemoteErrorCode {
  return code === 'busy' ? 'busy' : code === 'unknown-instance' ? 'gone' : 'unreachable'
}

export class RemoteError extends Error {
  constructor(readonly body: RemoteErrorBody) {
    super(remoteErrorText(body))
  }

  static of(code: RemoteErrorCode, message = code): RemoteError {
    return new RemoteError({ code, message })
  }
}

export interface RemoteClientDeps {
  link: {
    sendToDevice(to: string, kind: string, data: unknown): Promise<string | null>
    /** This device is connected to its server. */
    online(): boolean
  }
  log?: (message: string) => void
  timeoutMs?: number
}

interface Pending {
  instance: string
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/** How a watch is asked for: kept up, begun (nothing of before here), or begun anew after a gap. */
type WatchMode = 'renew' | 'start' | 'restart'

/**
 * This device as a controller: makes the calls of the window API at other devices (`invoke`) and keeps
 * up the watch of the devices the windows show, so their window events come, the lists among them made
 * whole again from what changed. The host decides what is allowed; this side only passes it on.
 */
export class RemoteClient extends TypedEmitter<{
  events: [instance: string, events: RemoteBroadcast[]]
  resync: [instance: string]
  info: [instance: string, info: RemoteHostInfo]
}> {
  private readonly pending = new Map<string, Pending>()
  /** Per device the chats watched there, as all windows together ask. */
  private watching = new Map<string, string[]>()
  private renewTimer: ReturnType<typeof setInterval> | null = null
  /** What the server refused to pass on before its request was waiting for an answer, by message id. */
  private readonly early = new Map<string, string>()
  /** Per device the lists of its list events (`LIST_EVENTS`), by event and id: the base of what changes. */
  private readonly lists = new Map<string, Map<string, Map<string, { id: string }>>>()

  constructor(private readonly deps: RemoteClientDeps) {
    super()
  }

  async request<M extends RemoteMethod>(instance: string, m: M, p: RemoteMethods[M]['params']): Promise<RemoteMethods[M]['result']> {
    if (!this.deps.link.online()) throw RemoteError.of('offline')
    let id: string | null
    try {
      id = await this.deps.link.sendToDevice(instance, RemoteKind.request, { m, p })
    } catch (error) {
      if (error instanceof MessageTooLargeError) throw RemoteError.of('too-large')
      throw error
    }
    if (!id) throw RemoteError.of(this.deps.link.online() ? 'unreachable' : 'offline')
    const failed = this.early.get(id)
    if (failed !== undefined) {
      this.early.delete(id)
      throw RemoteError.of(sendFailure(failed))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(RemoteError.of('timeout'))
      }, this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS)
      this.pending.set(id, { instance, resolve: resolve as (value: unknown) => void, reject, timer })
    })
  }

  /** A call of the window API at `instance`, answered by its handlers. */
  invoke(instance: string, ch: string, args: unknown[]): Promise<unknown> {
    return this.request(instance, 'invoke', { ch, args })
  }

  /** An `rc.response` or `rc.events` of another device. */
  onDeviceMessage(from: string, kind: string, data: unknown): void {
    if (kind === RemoteKind.response) {
      const response = parseRemoteResponse(data)
      const pending = response && this.pending.get(response.re)
      // Only the device asked answers: another member can't settle a request it never got.
      if (!response || !pending || pending.instance !== from) return
      this.settle(response.re, pending)
      if ('e' in response) pending.reject(new RemoteError(response.e))
      else pending.resolve(response.r)
    } else if (kind === RemoteKind.events && this.watching.has(from)) {
      const events = parseRemoteEvents(data)
      if (events?.length) this.receive(from, events)
    }
  }

  /** Events of a device, its lists whole again; a change without its base: the watch begins anew. */
  private receive(from: string, events: NonNullable<ReturnType<typeof parseRemoteEvents>>): void {
    const lists = this.lists.get(from) ?? new Map<string, Map<string, { id: string }>>()
    this.lists.set(from, lists)
    const whole: RemoteBroadcast[] = []
    for (const event of events) {
      if ('args' in event) {
        whole.push(event)
        continue
      }
      const list = applyDiff(event.diff, lists.get(event.ch) ?? new Map())
      if (!list) {
        // Something was lost on the way: what came so far goes, then everything anew.
        if (whole.length) this.emit('events', from, whole)
        this.renew(from, 'restart')
        return
      }
      lists.set(event.ch, new Map(list.map((e) => [e.id, e])))
      whole.push({ ch: event.ch, args: [list] })
    }
    if (whole.length) this.emit('events', from, whole)
  }

  /**
   * The server couldn't pass a request on: `code` as it said (`busy`: the device doesn't keep up,
   * `unknown-instance`: it was removed, else it isn't connected).
   */
  onSendFailed(id: string, code: string): void {
    const pending = this.pending.get(id)
    if (!pending) {
      // Before the request knew its id (`request` still on its way back from sending): it looks here.
      this.early.set(id, code)
      if (this.early.size > EARLY_KEPT) this.early.delete(this.early.keys().next().value!)
      return
    }
    this.settle(id, pending)
    pending.reject(RemoteError.of(sendFailure(code)))
  }

  /**
   * The devices all windows together show, with the chats open of them. A changed list goes to the
   * device at once; the order of requests holds, so a chat opened after its watch misses none of its
   * events.
   */
  setWatch(list: readonly RemoteWatch[]): void {
    const next = new Map<string, string[]>()
    for (const { instance, ids } of list) next.set(instance, [...new Set([...(next.get(instance) ?? []), ...ids])].sort())
    for (const instance of this.watching.keys()) {
      if (next.has(instance)) continue
      this.lists.delete(instance)
      void this.request(instance, 'unwatch', {}).catch(() => undefined)
    }
    const previous = this.watching
    this.watching = next
    for (const [instance, ids] of next) {
      if (!previous.has(instance)) this.renew(instance, 'start')
      else if (previous.get(instance)?.join() !== ids.join()) this.renew(instance, 'renew')
    }
    if (next.size && !this.renewTimer) this.renewTimer = setInterval(() => this.renewAll(), WATCH_RENEW_MS)
    if (!next.size && this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
  }

  /** This device logged in again: the watches may have run out meanwhile. */
  onConnected(): void {
    this.renewAll()
  }

  /** A device came back: it lost what this one watched there when it went. */
  onDeviceStatus(instance: string, online: boolean): void {
    if (online && this.watching.has(instance)) this.renew(instance, 'renew')
  }

  dispose(): void {
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.renewTimer = null
    for (const instance of this.watching.keys()) void this.request(instance, 'unwatch', {}).catch(() => undefined)
    this.watching.clear()
    this.lists.clear()
    for (const [id, pending] of this.pending) {
      this.settle(id, pending)
      pending.reject(RemoteError.of('offline'))
    }
  }

  private renewAll(): void {
    for (const instance of this.watching.keys()) this.renew(instance, 'renew')
  }

  private renew(instance: string, mode: WatchMode): void {
    const ids = this.watching.get(instance)
    if (!ids || !this.deps.link.online()) return
    // Starting anew: the host's lists come whole, so what is here of them counts no more.
    if (mode !== 'renew') this.lists.delete(instance)
    this.request(instance, 'watch', mode === 'renew' ? { ids } : { ids, fresh: true }).then(
      ({ renewed, ...info }) => {
        if (!this.watching.has(instance)) return
        this.emit('info', instance, info)
        // Begun just now: the windows read what they show anyway. Otherwise a gap means reading anew.
        if (mode === 'restart' || (mode === 'renew' && !renewed)) this.emit('resync', instance)
      },
      (error: unknown) => {
        this.deps.log?.(`remote: watch at ${instance} failed: ${error instanceof Error ? error.message : String(error)}`)
        if (error instanceof RemoteError && this.watching.has(instance)) {
          const { code } = error.body
          // The host said how far this device may go now (off, or no longer reading).
          if (code === 'disabled' || code === 'forbidden') this.emit('info', instance, { name: '', enabled: code !== 'disabled', level: 'off', version: '' })
        }
      },
    )
  }

  private settle(id: string, pending: Pending): void {
    clearTimeout(pending.timer)
    this.pending.delete(id)
  }
}
