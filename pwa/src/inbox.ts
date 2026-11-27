import { watch } from 'vue'
import { remote } from './client'
import { computers, computerStatus } from './computers'
import { watches } from './host'
import { createInboxStore } from './inbox-store'

/** The inbox over every computer that lets this device read. */
export const inbox = createInboxStore({
  invoke: (instance, ch, args) => remote.invoke(instance, ch, args),
  setWatch: (list) => watches.set('inbox', list),
})

remote.on('events', (from, events) => inbox.onEvents(from, events))
remote.on('resync', (from) => inbox.resync(from))

// Online, a member, Remote Control on and at least reading: those are listed (and watched).
watch(
  () => computers.value.filter((device) => computerStatus(device).level !== null).map((device) => device.id),
  (ids) => inbox.setComputers(ids),
  { immediate: true },
)
