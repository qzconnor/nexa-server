import { link, remote } from './client'
import { createHostStore } from './host-store'
import { createWatches } from './watches'

/** What all parts of the page watch, joined for the client. */
export const watches = createWatches((list) => remote.setWatch(list))

/** The computer the chats tab shows, with its chats (one at a time: a phone shows one screen). */
export const host = createHostStore({
  invoke: (instance, ch, args) => remote.invoke(instance, ch, args),
  setWatch: (list) => watches.set('host', list),
})

remote.on('events', (from, events) => host.onEvents(from, events))
remote.on('resync', (from) => void host.resync(from))
link.on('changed', (state) => {
  if (state.status === 'unpaired') host.reset()
  // Removed from the namespace: nothing of it to show or watch any more.
  else if (host.instance.value && !state.devices.some((device) => device.id === host.instance.value)) host.reset()
})
