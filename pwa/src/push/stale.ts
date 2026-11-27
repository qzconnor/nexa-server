import type { InboxEntry, InboxSection } from '@shared/inbox'
import { PUSH_REASONS, type PushReason } from '@shared/push'
import { notificationPath } from './open'

/** A notification as the browser lists it (`getNotifications`). */
export interface ShownNotification {
  data: unknown
  /** When it was shown (ms since 1970); not every browser says. */
  timestamp?: number
}

/**
 * A notification this young stays whatever the inbox says: the page may hold an inbox from just before
 * the question came, and the push be quicker than its next answer.
 */
export const FRESH_MS = 15_000

/** The chat of a computer a notification is about, and why; null for one that is no chat's (an unreadable push). */
export function notificationChat(data: unknown): { host: string; chat: string; reason: PushReason | null } | null {
  const path = notificationPath(data)
  if (!path) return null
  const [, host, chat] = path.split('/') as [string, string, string]
  const reason = (data as { reason?: unknown }).reason
  return { host, chat, reason: PUSH_REASONS.includes(reason as PushReason) ? (reason as PushReason) : null }
}

/** The sections of the inbox in which a chat still needs what a notification for `reason` says. */
const STILL: Record<PushReason | 'unknown', readonly InboxSection[]> = {
  input: ['waiting'],
  limit: ['trouble'],
  // A turn that failed is trouble, not unread.
  done: ['unread', 'trouble'],
  // Shown by a service worker that didn't note why yet.
  unknown: ['waiting', 'trouble', 'unread'],
}

/**
 * The notifications that are over by the inbox of their computer (`entriesOf`; null where it isn't
 * known): the question answered, the finished chat read or at work again, the limit past. What the
 * inbox doesn't list needs nothing.
 */
export function staleNotifications<T extends ShownNotification>(
  shown: readonly T[],
  entriesOf: (host: string) => readonly InboxEntry[] | null,
  now: number,
): T[] {
  return shown.filter((notification) => {
    const about = notificationChat(notification.data)
    if (!about || (notification.timestamp !== undefined && now - notification.timestamp < FRESH_MS)) return false
    const entries = entriesOf(about.host)
    if (!entries) return false
    const section = entries.find((entry) => entry.id === about.chat)?.section
    return !section || !STILL[about.reason ?? 'unknown'].includes(section)
  })
}
