/**
 * What a computer pushes to the phones paired as controllers (the web app of nexa-server): sealed for
 * each like a message between devices and handed to the server's Web Push (`push`, docs/NEXA-SERVER.md,
 * „Push“). The PWA copies this file byte for byte, so it imports nothing.
 */

/** `kind` of the push. The server sees it, so it says no more than that it is one. */
export const PUSH_KIND = 'push.notify'

export const PUSH_VERSION = 1

export type PushReason = 'done' | 'input' | 'limit'
export const PUSH_REASONS: readonly PushReason[] = ['done', 'input', 'limit']

/**
 * Characters of title and text. A push carries at most about 4 KB, sealing and base64 add about half:
 * even in characters of three bytes each the whole stays well below.
 */
export const MAX_PUSH_TITLE = 100
export const MAX_PUSH_BODY = 300

export interface PushNotice {
  v: typeof PUSH_VERSION
  reason: PushReason
  /** The chat on the computer that sent it (the sender of the push), its session id. */
  chat: string
  title: string
  /** The chat's title, and below it what happened (the beginning of the answer, the question). */
  body: string
}

/** As session ids are checked elsewhere (`remote-chats.ts`); it goes into the address of the chat. */
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/

function cut(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

export function pushNotice(reason: PushReason, chat: string, title: string, body: string): PushNotice {
  return { v: PUSH_VERSION, reason, chat, title: cut(title, MAX_PUSH_TITLE), body: cut(body, MAX_PUSH_BODY) }
}

/** Null for anything that isn't a notice of this version; text over the limits is cut, not refused. */
export function parsePushNotice(data: unknown): PushNotice | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const { v, reason, chat, title, body } = data as Record<string, unknown>
  if (v !== PUSH_VERSION || !PUSH_REASONS.includes(reason as PushReason)) return null
  if (typeof chat !== 'string' || !CHAT_ID.test(chat) || typeof title !== 'string' || typeof body !== 'string') return null
  return pushNotice(reason as PushReason, chat, title, body)
}
