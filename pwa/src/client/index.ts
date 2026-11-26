import { LinkService } from './link-service'
import { RemoteClient } from './remote/remote-client'

// Protocol-level only, like the desktop's log: ids, kinds and errors, never content.
const log = (message: string) => console.debug(`[nexa] ${message}`)

/** The pairing of this page; with Vite in development the server is the one the code names. */
export const link = new LinkService({ serverUrl: location.origin, anyServer: import.meta.env.DEV, log })

/** This device as a controller of the computers (`rc.request` out, `rc.response` and `rc.events` back). */
export const remote = new RemoteClient({
  link: { sendToDevice: (to, kind, data) => link.sendToDevice(to, kind, data), online: () => link.online() },
  log,
})

// A controller answers no requests: the computers send it none (role `controller`), only answers and events.
link.on('deviceMessage', (from, kind, _id, data) => remote.onDeviceMessage(from, kind, data))
link.on('deviceSendFailed', (id, code) => remote.onSendFailed(id, code))
link.on('connected', () => remote.onConnected())
link.on('deviceStatus', (id, online) => remote.onDeviceStatus(id, online))
