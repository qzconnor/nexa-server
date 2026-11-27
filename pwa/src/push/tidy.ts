/**
 * Notifications that are over go while the web app is open, in front or not: those its inbox gives no
 * reason for any more (`staleNotifications`), and those of the chat on screen. A computer pushes no
 * `resolved` to a phone that is connected, and the server none to an iPhone: this does it for them.
 */

import { watch } from 'vue'
import { inbox } from '../inbox'
import { pageVisible } from '../visibility'
import { chatTag, UNREADABLE_PUSH } from './open'
import { staleNotifications } from './stale'

const SCOPE = import.meta.env.BASE_URL

/** This web app's notifications on screen (of one tag); none where the browser can't list them. */
async function shownNotifications(tag?: string): Promise<Notification[]> {
  if (typeof navigator.serviceWorker === 'undefined') return []
  try {
    const registration = await navigator.serviceWorker.getRegistration(SCOPE)
    return (await registration?.getNotifications(tag === undefined ? undefined : { tag })) ?? []
  } catch {
    return []
  }
}

/** The notifications of a chat: read right here, they have said what they had to. */
export async function closeChatNotifications(host: string, chat: string): Promise<void> {
  for (const notification of await shownNotifications(chatTag(host, chat))) notification.close()
}

async function tidy(): Promise<void> {
  const shown = await shownNotifications()
  if (!shown.length) return
  const entriesOf = (host: string) => {
    const computer = inbox.computers.get(host)
    return computer?.loaded && !computer.error ? computer.entries : null
  }
  for (const notification of staleNotifications(shown, entriesOf, Date.now())) notification.close()
  // The app is in front: what a push it couldn't read asked for is done.
  if (pageVisible.value) for (const notification of shown) if (notification.tag === UNREADABLE_PUSH.tag) notification.close()
}

/** Tidies now, whenever an inbox of a computer comes anew, and when the app comes to the front. */
export function startNotificationTidy(): void {
  watch(
    () => [pageVisible.value, ...[...inbox.computers.values()].map((computer) => (computer.loaded ? computer.entries : null))],
    () => void tidy(),
    { immediate: true },
  )
}
