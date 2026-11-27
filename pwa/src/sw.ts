/**
 * The web app's service worker, at /app/sw.js with the scope /app/ (built by the plugin in
 * vite.config.ts as a classic script). It only shows the computers' pushes and opens the app on a
 * click; it caches nothing and answers no requests, so the page always comes fresh from the server.
 *
 * It reads the pairing from IndexedDB, as the page stores it: the keys to open a push never leave this
 * browser, and the server only ever sees ciphertext (docs/PROTOCOL.md, „Push“).
 */

import { LinkStore } from './client/server-link/link-store'
import { notificationPath, OPEN_MESSAGE, openPush, pushNotification, UNREADABLE_PUSH, type PushNotification } from './push/open'

// The WebWorker lib types `self` as a plain worker; this one is a service worker.
const sw = self as unknown as ServiceWorkerGlobalScope
const store = new LinkStore()

// Nothing cached that a new version would have to wait for: it takes over at once.
sw.addEventListener('install', () => void sw.skipWaiting())
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()))

sw.addEventListener('push', (event) => event.waitUntil(showPush(event.data)))

sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openApp(notificationPath(event.notification.data)))
})

async function showPush(data: PushMessageData | null): Promise<void> {
  let shown: PushNotification = UNREADABLE_PUSH
  try {
    const link = await store.load()
    const opened = link && data ? await openPush(data.json(), link) : null
    if (opened) shown = pushNotification(opened, link!)
    // Ids only, never what it says.
    else console.debug('[nexa] push: not readable')
  } catch (error) {
    console.debug(`[nexa] push: ${error instanceof Error ? error.name : 'failed'}`)
  }
  await sw.registration.showNotification(shown.title, {
    body: shown.body,
    tag: shown.tag,
    data: { path: shown.path },
    icon: new URL('icon.png', sw.registration.scope).href,
    lang: 'de',
  })
}

/** Into a window of the app that is open already, else a new one; `path` is relative to the app. */
async function openApp(path: string): Promise<void> {
  const scope = sw.registration.scope
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows.find((client) => client.url.startsWith(scope))
  if (open) {
    // The page's router goes there without loading anew (main.ts listens).
    open.postMessage({ type: OPEN_MESSAGE, path })
    await open.focus().catch(() => undefined)
    return
  }
  await sw.clients.openWindow(new URL(path, scope).href)
}
