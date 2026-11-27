/**
 * What the service worker makes of a push (docs/PROTOCOL.md, „Push“): its payload is the JSON of the
 * message a `send` would relay, sealed by a computer for this device alone. It is checked like a message
 * over the WebSocket, except for the replay window: a push may wait at the push service for up to a day
 * (hint 5 there). A push that comes twice shows twice in the same place, as its notification has a tag.
 *
 * No DOM and no service worker APIs here, so the app's tests can run it.
 */

import { openSealed, pairwiseKey, PAIRWISE, parseSealed, verifyOpened } from '@shared/nexa-server/envelope'
import { REPLAY_WINDOW_MS } from '@shared/nexa-server/members'
import { PUSH_TTL_MAX } from '@shared/nexa-server/protocol'
import { parsePush, PUSH_KIND, type PushMessage, type PushNotice, type PushReason } from '@shared/push'
import type { StoredLink } from '../client/server-link/link-store'

/** As long as the longest `ttl`, and the clocks of computer and phone may differ a little. */
const MAX_AGE_MS = PUSH_TTL_MAX * 1000 + REPLAY_WINDOW_MS

/** What the service worker posts to an open window of the app for a click: go to `path`. */
export const OPEN_MESSAGE = 'nexa:open'

export interface OpenedPush<T extends PushMessage = PushMessage> {
  /** The computer that sent it. */
  from: string
  notice: T
}

export type PushLink = Pick<StoredLink, 'instance' | 'identity' | 'members' | 'devices'>

export async function openPush(payload: unknown, link: PushLink, now = Date.now()): Promise<OpenedPush | null> {
  if (typeof payload !== 'object' || payload === null) return null
  const { t, id, from, to, kind, body } = payload as Record<string, unknown>
  if (t !== 'msg' || typeof id !== 'string' || typeof from !== 'string' || to !== link.instance || kind !== PUSH_KIND) return null
  const member = link.members.find((m) => m.id === from)
  const sealed = parseSealed(body)
  if (!member || sealed?.k !== PAIRWISE) return null
  const key = await pairwiseKey({ id: link.instance, dhPrivate: link.identity.dhPrivate }, member)
  const opened = key && (await openSealed({ from, to, kind, id }, sealed, key))
  if (!opened || !(await verifyOpened(opened, member.signKey))) return null
  if (now - opened.at > MAX_AGE_MS || opened.at - now > REPLAY_WINDOW_MS) return null
  const notice = parsePush(opened.data)
  return notice && { from, notice }
}

export interface PushNotification {
  title: string
  body: string
  /** One per chat: the next event of a chat replaces its notification instead of piling up. */
  tag: string
  /** Where a click leads, relative to the app (`notificationPath` checks it). */
  path: string
  /** What happened, for taking it away once it is over (`staleNotifications`); none for an unreadable push. */
  reason?: PushReason
}

/** The tag of a chat's notification: one per chat of a computer. */
export function chatTag(from: string, chat: string): string {
  return `${from}:${chat}`
}

export function pushNotification({ from, notice }: OpenedPush<PushNotice>, link: Pick<PushLink, 'devices'>): PushNotification {
  // With more than one computer the phone has to say which one it was.
  const computers = link.devices.filter((d) => d.role === 'host')
  const name = computers.length > 1 ? computers.find((d) => d.id === from)?.name : undefined
  return {
    title: notice.title,
    body: name ? `${name} · ${notice.body}` : notice.body,
    tag: chatTag(from, notice.chat),
    path: `chats/${from}/${notice.chat}`,
    reason: notice.reason,
  }
}

/**
 * For a push that doesn't open: browsers want a notification for every push, and Safari drops the
 * subscription of a page that shows none. Its tag keeps them to one.
 */
export const UNREADABLE_PUSH: PushNotification = {
  title: 'Nexa',
  body: 'Ein Computer hat etwas für dich. Öffne Nexa, um es zu sehen.',
  tag: 'nexa',
  path: '',
}

const PATH = /^(?:chats\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128})?$/

/** The path a notification's data names, if it is one of ours: a chat, or the inbox (empty). */
export function notificationPath(data: unknown): string {
  const path = (data as { path?: unknown } | null)?.path
  return typeof path === 'string' && PATH.test(path) ? path : ''
}
