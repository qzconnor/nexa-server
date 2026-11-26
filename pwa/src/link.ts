import { reactive, ref, shallowRef } from 'vue'
import { link, remote } from './client'
import { RemoteError } from './client/remote/remote-client'
import { PAIRING_PREFIX } from './shared/nexa-server/pairing-code'
import type { RemoteHostInfo } from './shared/remote'

/** The pairing as the views show it. */
export const linkState = shallowRef(link.getState())

/** What a computer answered to `hello`: whether Remote Control is on there, and how far it lets this device. */
export interface HostAnswer {
  info: RemoteHostInfo | null
  error: string | null
  asking: boolean
}
export const hosts = reactive(new Map<string, HostAnswer>())

/** A pairing code from a link (`/app#nexa1:…`), for the pairing page; never in the address bar for long. */
export const pendingPairingCode = ref<string | null>(null)

/** Counts logins: each one asks every computer again, as its answer may have changed meanwhile. */
let login = 0
const asked = new Map<string, number>()

link.on('changed', (state) => {
  linkState.value = state
  if (state.status === 'unpaired') {
    hosts.clear()
    asked.clear()
  }
  askHosts()
})
link.on('connected', () => {
  login++
  askHosts()
})
link.on('deviceStatus', (id, online) => {
  // Back: ask again once it is a member (a `changed` follows); its settings may be others now.
  if (online) asked.delete(id)
})
// Each renewal of a watch says it again: a level changed at the computer shows without asking.
remote.on('info', (id, info) => {
  const before = hosts.get(id)?.info
  // Refused (off, or not even reading): the client knows the level, not the name.
  hosts.set(id, { info: { ...info, name: info.name || before?.name || '', version: info.version || before?.version || '' }, error: null, asking: false })
})

/** Asks each computer that is online and a member, once per login, what it lets this device do. */
function askHosts(): void {
  const state = linkState.value
  if (state.status !== 'online') return
  for (const device of state.devices) {
    if (device.self || device.role !== 'host' || !device.online || !device.trusted || asked.get(device.id) === login) continue
    asked.set(device.id, login)
    const before = hosts.get(device.id)
    hosts.set(device.id, { info: before?.info ?? null, error: null, asking: true })
    remote.request(device.id, 'hello', {}).then(
      (info) => hosts.set(device.id, { info, error: null, asking: false }),
      (error: unknown) => {
        hosts.set(device.id, { info: before?.info ?? null, error: error instanceof RemoteError ? error.message : String(error), asking: false })
        // Asked again with the next change, e.g. the next login.
        asked.delete(device.id)
      },
    )
  }
}

/**
 * Takes a pairing code out of the address (a QR code's link) before anything else reads it: it holds
 * the namespace's key, and the address bar, the history and a bookmark are no place for that.
 */
export function takePairingCodeFromUrl(): string | null {
  const hash = window.location.hash.slice(1)
  if (!hash.startsWith(PAIRING_PREFIX)) return null
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  pendingPairingCode.value = hash
  return hash
}

export function startLink(): void {
  void link.init()
  // A phone drops the connection in the background; back in front it needn't wait for the next attempt.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') link.retryNow()
  })
  window.addEventListener('online', () => link.retryNow())
}
