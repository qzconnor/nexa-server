/** What subscription.ts needs to know of the browser, apart so the tests can run it without one. */

import { toBase64url } from '@shared/nexa-server/auth'
import type { PushSubscriptionKeys } from '../client/link-service'

/** `home-screen`: Safari on iPhone and iPad, which pushes only to a web app opened from the home screen. */
export type PushSupport = 'yes' | 'home-screen' | 'no'

export function pushSupport(env: { apis: boolean; userAgent: string; touchPoints: number; standalone: boolean }): PushSupport {
  if (env.apis) return 'yes'
  // iPadOS says it is a Mac; only the touch screen gives it away.
  const apple = /iPad|iPhone|iPod/.test(env.userAgent) || (env.userAgent.includes('Macintosh') && env.touchPoints > 1)
  return apple && !env.standalone ? 'home-screen' : 'no'
}

/** From the raw keys rather than `toJSON()`, whose base64url some browsers pad, which the server refuses. */
export function subscriptionKeys(subscription: Pick<PushSubscription, 'endpoint' | 'getKey'>): PushSubscriptionKeys {
  const p256dh = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')
  if (!p256dh || !auth) throw new Error('Der Browser liefert keine Schlüssel für Push.')
  return { endpoint: subscription.endpoint, p256dh: toBase64url(new Uint8Array(p256dh)), auth: toBase64url(new Uint8Array(auth)) }
}

/** Whether a subscription was made for this VAPID key (raw); one for another key gets no pushes. */
export function sameKey(subscription: Pick<PushSubscription, 'options'>, key: Uint8Array): boolean {
  const own = subscription.options.applicationServerKey
  if (!own || own.byteLength !== key.length) return false
  const bytes = new Uint8Array(own)
  return bytes.every((byte, i) => byte === key[i])
}
