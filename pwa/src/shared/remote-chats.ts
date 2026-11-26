/**
 * Messages between chats across devices (Remote Control, `chats.*`): the chat tools of one device's
 * agents (main/mcp/chat-tools.ts) list, read, search and write to the chats of another paired device.
 * Apart from the window API (`invoke`) on purpose: whether an agent gets through is the receiving
 * device's setting „Nachrichten zwischen Chats“ together with the level it gives the sender, and the
 * receiver checks both itself (main/remote/remote-chats.ts).
 */

import { PROVIDER_IDS, type ProviderId, type SessionStatus } from './chat'
import type { RemoteLevel } from './remote'
import type { SessionSearchHit } from './types'

/** A chat as the agents of another device see it (the host's `PeerChat`). */
export interface RemoteChat {
  id: string
  title: string
  provider: ProviderId
  projectId: string
  project: string
  /** The folder its agent works in, on the host. */
  folder: string
  status: SessionStatus
  updatedAt: number
  archived: boolean
}

/** The chat a message comes from, as the sending device says; which device that is, the receiver knows itself. */
export interface RemoteChatSender {
  sessionId: string
  title: string
  provider: ProviderId
}

export interface RemoteChatFound {
  chat: RemoteChat
  /** Where the words are in its conversation; none: in its title. */
  hit?: SessionSearchHit
}

/** The requests, with what each takes and returns (merged into `RemoteMethods`). */
export interface RemoteChatMethods {
  /** The host's chats, newest first, archived ones too (at most `MAX_REMOTE_CHATS`). */
  'chats.list': { params: Record<string, never>; result: { chats: RemoteChat[] } }
  /** The latest prompts and answers of one of them, as text for an agent (`chatTranscript`). */
  'chats.read': { params: { id: string; last: number }; result: { chat: RemoteChat; transcript: string } }
  /**
   * The chats whose title or prompts and answers hold every word of `query`, newest first (at most
   * `MAX_REMOTE_FOUND`; `total`: all that fit), with `project` only those of that project.
   */
  'chats.search': { params: { query: string; project?: string }; result: { found: RemoteChatFound[]; total: number } }
  /**
   * A message to one of the host's chats. `chain`: its place in the chain of messages between chats
   * as the sender counted it, so that the limit holds across devices. Answers the chat as it was before.
   */
  'chats.send': { params: { from: RemoteChatSender; chain: number; to: string; text: string }; result: { chat: RemoteChat } }
  /**
   * A new chat at the host with the message as its first prompt: in the project `project` names, else
   * in the one called like the sender's (`near`).
   */
  'chats.new': {
    params: { from: RemoteChatSender; chain: number; provider: ProviderId; text: string; title?: string; project?: string; near?: string }
    result: { id: string; title: string; project: string }
  }
}

export type RemoteChatMethod = keyof RemoteChatMethods

export type RemoteChatRequest = { [M in RemoteChatMethod]: { m: M; p: RemoteChatMethods[M]['params'] } }[RemoteChatMethod]

/** Reading another device's chats is looking, writing to them is a prompt (as `sessions:send` is). */
export const CHAT_METHOD_LEVEL: Record<RemoteChatMethod, RemoteLevel> = {
  'chats.list': 'read',
  'chats.read': 'read',
  'chats.search': 'read',
  'chats.send': 'prompt',
  'chats.new': 'prompt',
}

/** Chats `chats.list` gives at most: the newest; enough to find one by name. */
export const MAX_REMOTE_CHATS = 500
/** Chats `chats.search` gives at most (chat-tools shows 50 at most). */
export const MAX_REMOTE_FOUND = 50
/** Prompts and answers `chats.read` gives at most (as `chat_read`). */
export const MAX_REMOTE_READ = 30
/** One message to another device's chat, in characters: it has to fit the relay in a few parts. */
export const MAX_REMOTE_MESSAGE = 100_000
const MAX_QUERY = 500
const MAX_NAME = 300

// --- Ids of other devices' chats ----------------------------------------------------------------------

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
/** `<instance>:<session>`: a colon is in no instance and no session id, so it can't be taken for a chat of this device. */
const REMOTE_CHAT_ID = /^([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,128})$/

/** The id by which the agents of this device name the chat `session` of the device `device`. */
export function remoteChatId(device: string, session: string): string {
  return `${device}:${session}`
}

/** The device and the chat there of an id of `remoteChatId`; null for anything else. */
export function parseRemoteChatId(id: string): { device: string; session: string } | null {
  const match = REMOTE_CHAT_ID.exec(id.trim())
  return match ? { device: match[1]!, session: match[2]! } : null
}

// --- Parsing what comes over the relay ---------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isSessionId = (value: unknown): value is string => typeof value === 'string' && SESSION_ID.test(value)
const isProvider = (value: unknown): value is ProviderId => typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)

/** A text that has to be there: trimmed, not empty, at most `max` characters; null otherwise. */
function required(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length > max) return null
  return value.trim() || null
}

/** A text that may be missing (undefined, also when empty); null when it is something else or too long. */
function optional(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max) return null
  return value.trim() || undefined
}

function parseSender(value: unknown): RemoteChatSender | null {
  if (!isRecord(value) || !isSessionId(value.sessionId) || !isProvider(value.provider) || typeof value.title !== 'string') return null
  return { sessionId: value.sessionId, title: value.title.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME), provider: value.provider }
}

const isChain = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1

/** A `chats.*` request as the host takes it, its parameters checked; null when it isn't one. */
export function parseChatRequest(m: string, p: Record<string, unknown>): RemoteChatRequest | null {
  switch (m) {
    case 'chats.list':
      return { m, p: {} }
    case 'chats.read': {
      if (!isSessionId(p.id) || !Number.isSafeInteger(p.last) || (p.last as number) < 1) return null
      return { m, p: { id: p.id, last: Math.min(p.last as number, MAX_REMOTE_READ) } }
    }
    case 'chats.search': {
      const query = required(p.query, MAX_QUERY)
      const project = optional(p.project, MAX_NAME)
      if (query === null || project === null) return null
      return { m, p: { query, ...(project ? { project } : {}) } }
    }
    case 'chats.send': {
      const from = parseSender(p.from)
      const text = required(p.text, MAX_REMOTE_MESSAGE)
      if (!from || !isChain(p.chain) || !isSessionId(p.to) || text === null) return null
      return { m, p: { from, chain: p.chain, to: p.to, text } }
    }
    case 'chats.new': {
      const from = parseSender(p.from)
      const text = required(p.text, MAX_REMOTE_MESSAGE)
      const title = optional(p.title, MAX_NAME)
      const project = optional(p.project, MAX_NAME)
      const near = optional(p.near, MAX_NAME)
      if (!from || !isChain(p.chain) || !isProvider(p.provider) || text === null || title === null || project === null || near === null) return null
      return { m, p: { from, chain: p.chain, provider: p.provider, text, ...(title ? { title } : {}), ...(project ? { project } : {}), ...(near ? { near } : {}) } }
    }
    default:
      return null
  }
}

const STATUSES: readonly SessionStatus[] = ['idle', 'starting', 'running', 'waiting', 'error', 'stopped']

/** A chat of another device's answer; null when it isn't one. It comes from a member, but a broken one mustn't break the tools. */
export function parseRemoteChat(value: unknown): RemoteChat | null {
  if (!isRecord(value) || !isSessionId(value.id) || typeof value.title !== 'string' || !isProvider(value.provider)) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    id: value.id,
    title: value.title.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME),
    provider: value.provider,
    projectId: str(value.projectId),
    project: str(value.project).slice(0, MAX_NAME),
    folder: str(value.folder).slice(0, 1000),
    status: STATUSES.includes(value.status as SessionStatus) ? (value.status as SessionStatus) : 'idle',
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
    archived: value.archived === true,
  }
}

function parseHit(value: unknown): SessionSearchHit | undefined {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.snippet !== 'string' || !isProvider(value.provider)) return undefined
  return { sessionId: value.sessionId, role: value.role === 'user' ? 'user' : 'assistant', provider: value.provider, snippet: value.snippet.slice(0, 1000) }
}

/** The answers to the requests, checked; null when an answer isn't one. */
export const parseChatResult = {
  'chats.list'(value: unknown): RemoteChatMethods['chats.list']['result'] | null {
    if (!isRecord(value) || !Array.isArray(value.chats)) return null
    return { chats: value.chats.slice(0, MAX_REMOTE_CHATS).map(parseRemoteChat).filter((chat) => chat !== null) }
  },
  'chats.read'(value: unknown): RemoteChatMethods['chats.read']['result'] | null {
    const chat = isRecord(value) ? parseRemoteChat(value.chat) : null
    if (!chat || typeof (value as Record<string, unknown>).transcript !== 'string') return null
    return { chat, transcript: (value as { transcript: string }).transcript }
  },
  'chats.search'(value: unknown): RemoteChatMethods['chats.search']['result'] | null {
    if (!isRecord(value) || !Array.isArray(value.found)) return null
    const found: RemoteChatFound[] = []
    for (const entry of value.found.slice(0, MAX_REMOTE_FOUND)) {
      const chat = isRecord(entry) ? parseRemoteChat(entry.chat) : null
      if (!chat) continue
      const hit = parseHit((entry as Record<string, unknown>).hit)
      found.push(hit ? { chat, hit } : { chat })
    }
    const total = Number.isSafeInteger(value.total) ? Math.max(value.total as number, found.length) : found.length
    return { found, total }
  },
  'chats.send'(value: unknown): RemoteChatMethods['chats.send']['result'] | null {
    const chat = isRecord(value) ? parseRemoteChat(value.chat) : null
    return chat ? { chat } : null
  },
  'chats.new'(value: unknown): RemoteChatMethods['chats.new']['result'] | null {
    if (!isRecord(value) || !isSessionId(value.id) || typeof value.title !== 'string') return null
    return { id: value.id, title: value.title.slice(0, MAX_NAME), project: typeof value.project === 'string' ? value.project.slice(0, MAX_NAME) : '' }
  },
} satisfies { [M in RemoteChatMethod]: (value: unknown) => RemoteChatMethods[M]['result'] | null }
