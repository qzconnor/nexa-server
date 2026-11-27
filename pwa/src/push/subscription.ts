/**
 * Notifications on this device (Einstellungen › Benachrichtigungen): the service worker, the browser's
 * permission, a push subscription with the server's VAPID key (`vapidKey` in /v1/info), and handing it
 * to the server (`push-subscribe`). The computers decide what they push (their setting „Aufs Handy
 * schicken“); the service worker (sw.ts) shows it.
 */

import { fromBase64url } from '@shared/nexa-server/auth'
import type { ServerInfo } from '@shared/nexa-server/protocol'
import { reactive } from 'vue'
import type { Router } from 'vue-router'
import { link } from '../client'
import { ServerError } from '../client/server-link/connection'
import { pushSupport, sameKey, subscriptionKeys } from './browser'
import { notificationPath, OPEN_MESSAGE } from './open'

const SCOPE = import.meta.env.BASE_URL
/** `navigator.serviceWorker.ready` waits forever for a worker that never registered. */
const READY_TIMEOUT_MS = 10_000

export const pushState = reactive({
  support: pushSupport({
    apis: typeof navigator.serviceWorker !== 'undefined' && 'PushManager' in window && 'Notification' in window,
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  }),
  permission: (typeof Notification === 'undefined' ? 'default' : Notification.permission) as NotificationPermission,
  /** Whether this server pushes at all (only with the web app); null until /v1/info answered. */
  server: null as boolean | null,
  /** This browser has a subscription and handed it to the server. */
  on: false,
  busy: false,
  error: null as string | null,
})

/** Registers the service worker and keeps the subscription in step with the pairing. */
export function startPush(router: Router): void {
  if (pushState.support !== 'yes') return
  // `updateViaCache: 'none'`: a new sw.js counts at once, whatever caches stand between.
  navigator.serviceWorker.register(`${SCOPE}sw.js`, { scope: SCOPE, updateViaCache: 'none' }).catch((error: unknown) => {
    console.debug(`[nexa] service worker: ${error instanceof Error ? error.message : String(error)}`)
  })
  // A click on a notification while the app is open: there without loading anew.
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: unknown; path?: unknown }>) => {
    if (event.data?.type === OPEN_MESSAGE) void router.push(`/${notificationPath(event.data)}`)
  })
  void currentSubscription().then((subscription) => (pushState.on = subscription !== null))

  let paired = false
  link.on('changed', (state) => {
    const was = paired
    paired = state.status !== 'unpaired' && state.status !== 'loading'
    // Unpaired or removed: the server dropped the subscription with the instance; the browser drops its own.
    if (was && !paired) void dropSubscription()
  })
  link.on('connected', () => void syncPush())
}

/** Turns notifications on: asks for the permission (only from a tap), subscribes, tells the server. */
export async function enablePush(): Promise<void> {
  if (pushState.busy) return
  pushState.busy = true
  pushState.error = null
  let subscription: PushSubscription | null = null
  try {
    // First, before anything is awaited: browsers ask only in answer to a tap.
    pushState.permission = await Notification.requestPermission()
    if (pushState.permission !== 'granted') {
      if (pushState.permission === 'default') pushState.error = 'Ohne deine Erlaubnis kommen keine Benachrichtigungen.'
      return
    }
    subscription = await subscribe()
    await link.subscribePush(subscriptionKeys(subscription))
    pushState.on = true
  } catch (error) {
    pushState.error = errorText(error)
    // Half on helps nobody: without the server knowing it, the subscription gets nothing.
    await subscription?.unsubscribe().catch(() => undefined)
    pushState.on = false
  } finally {
    pushState.busy = false
  }
}

/** Turns them off: the server forgets the subscription, and so does the browser, which is what counts. */
export async function disablePush(): Promise<void> {
  if (pushState.busy) return
  pushState.busy = true
  pushState.error = null
  try {
    // Offline the server keeps it until the push service tells it the subscription is gone.
    if (link.online()) await link.unsubscribePush().catch((error: unknown) => console.debug(`[nexa] push-unsubscribe: ${String(error)}`))
    await dropSubscription()
  } catch (error) {
    pushState.error = errorText(error)
  } finally {
    pushState.busy = false
  }
}

/** Whether /v1/info offers push; for the settings page before anyone taps. */
export async function checkServerPush(): Promise<void> {
  try {
    pushState.server = (await serverKey()) !== null
  } catch {
    pushState.server = null
  }
}

/**
 * After each login: hands the subscription to the server again (it may have dropped it, or this is
 * another server version), and subscribes anew if the server's key changed meanwhile.
 */
async function syncPush(): Promise<void> {
  if (pushState.support !== 'yes') return
  try {
    const subscription = await currentSubscription()
    pushState.permission = Notification.permission
    if (!subscription) {
      pushState.on = false
      return
    }
    // The permission was taken back in the browser's settings: then nothing would show anyway.
    if (pushState.permission !== 'granted') {
      await link.unsubscribePush().catch(() => undefined)
      await dropSubscription()
      return
    }
    const key = await serverKey()
    if (!key) {
      await dropSubscription()
      return
    }
    const current = sameKey(subscription, key) ? subscription : await subscribe()
    await link.subscribePush(subscriptionKeys(current))
    pushState.on = true
  } catch (error) {
    console.debug(`[nexa] push sync: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Der Service Worker startet nicht. Lade die Seite neu.')), READY_TIMEOUT_MS)
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registered = await navigator.serviceWorker.getRegistration(SCOPE)
  return (await registered?.pushManager.getSubscription()) ?? null
}

/** A subscription for the server's current key: the one there is if it fits, else a new one. */
async function subscribe(): Promise<PushSubscription> {
  const key = await serverKey()
  if (!key) throw new Error('Dieser Server schickt keine Benachrichtigungen.')
  const { pushManager } = await registration()
  const existing = await pushManager.getSubscription()
  if (existing && sameKey(existing, key)) return existing
  await existing?.unsubscribe()
  return pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

async function dropSubscription(): Promise<void> {
  const subscription = await currentSubscription().catch(() => null)
  await subscription?.unsubscribe()
  pushState.on = false
}

let info: Promise<ServerInfo> | null = null

/** The server's VAPID key, raw; null when it doesn't push. */
async function serverKey(): Promise<Uint8Array<ArrayBuffer> | null> {
  info ??= fetch('/v1/info', { cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<ServerInfo>
  })
  // Asked again next time when it failed (offline).
  info.catch(() => (info = null))
  const key = (await info).vapidKey
  return key ? fromBase64url(key) : null
}

function errorText(error: unknown): string {
  if (error instanceof ServerError) {
    if (error.code === 'offline' || error.code === 'timeout') return 'Keine Verbindung zum Server. Versuch es gleich noch einmal.'
    // The server takes only the push services it knows (docs/PROTOCOL.md, „Push“).
    if (error.code === 'bad-request') return 'Der Server nimmt den Push-Dienst dieses Browsers nicht an.'
    return `Der Server hat abgelehnt (${error.code}).`
  }
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Der Browser erlaubt dieser Seite keine Benachrichtigungen.'
    if (error.name === 'AbortError') return 'Der Push-Dienst des Browsers ist nicht erreichbar.'
  }
  return error instanceof Error ? error.message : String(error)
}
