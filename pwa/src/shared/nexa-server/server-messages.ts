/**
 * Reads what the server sends. The server is not trusted with content, and a broken or hostile one must
 * not crash the app or slip odd values into the list of devices: every message is checked against
 * `protocol.ts`, and anything else is dropped.
 */

import {
  isInstanceId,
  normalizeInstanceName,
  PROTOCOL_VERSION,
  ROLES,
  type ErrorCode,
  type InstanceInfo,
  type Role,
  type ServerLimits,
  type ServerMessage,
} from './protocol'

const ERROR_CODES: readonly ErrorCode[] = [
  'bad-request',
  'unknown-instance',
  'unreachable',
  'busy',
  'rate-limited',
  'invite-invalid',
  'namespace-full',
  'internal',
]
const INSTANCE_EVENTS = ['joined', 'online', 'offline', 'renamed'] as const
const BASE64URL = /^[A-Za-z0-9_-]{1,256}$/
const REQUEST_ID = /^[\x21-\x7e]{1,128}$/
const KIND = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/
/** A namespace has at most as many instances as the server allows (20 by default). */
const MAX_INSTANCES = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isText = (value: unknown, pattern: RegExp): value is string => typeof value === 'string' && pattern.test(value)

/** What nexa-server allows unless its admin set otherwise; also assumed of a server that doesn't say (before `limits`). */
export const DEFAULT_SERVER_LIMITS: ServerLimits = { maxMessageBytes: 1024 * 1024, rateLimit: 100 }

/** The server's `limits`, each value only within sense; what is missing or odd stays at the default. */
export function parseLimits(data: unknown): ServerLimits {
  const limits = isRecord(data) ? data : {}
  const within = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
  return {
    maxMessageBytes: within(limits.maxMessageBytes, 1024, 64 * 1024 * 1024) ? (limits.maxMessageBytes as number) : DEFAULT_SERVER_LIMITS.maxMessageBytes,
    rateLimit: within(limits.rateLimit, 1, 100_000) ? (limits.rateLimit as number) : DEFAULT_SERVER_LIMITS.rateLimit,
  }
}

export function parseInstanceInfo(data: unknown): InstanceInfo | null {
  if (!isRecord(data)) return null
  const { id, role, signKey, dhKey, createdAt, lastSeen, online } = data
  const name = normalizeInstanceName(data.name)
  if (!isInstanceId(id) || name === null || !ROLES.includes(role as Role)) return null
  if (!isText(signKey, BASE64URL) || !isText(dhKey, BASE64URL)) return null
  if (!isTime(createdAt) || (lastSeen !== null && !isTime(lastSeen)) || typeof online !== 'boolean') return null
  return { id, name, role: role as Role, signKey, dhKey, createdAt, lastSeen, online }
}

function parseInstances(data: unknown): InstanceInfo[] | null {
  if (!Array.isArray(data) || data.length > MAX_INSTANCES) return null
  const list: InstanceInfo[] = []
  for (const entry of data) {
    const info = parseInstanceInfo(entry)
    if (!info) return null
    list.push(info)
  }
  return list
}

/** One text frame of the server; null for anything that isn't a message of protocol version 1. */
export function parseServerMessage(text: string): ServerMessage | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  switch (data.t) {
    case 'hello':
      // Another version is answered by the caller (it stops), so it passes here.
      if (typeof data.v !== 'number' || !isText(data.nonce, BASE64URL)) return null
      return { t: 'hello', v: data.v as typeof PROTOCOL_VERSION, nonce: data.nonce }
    case 'ready': {
      const instances = parseInstances(data.instances)
      if (!isInstanceId(data.instance) || typeof data.namespace !== 'string' || !instances) return null
      return { t: 'ready', instance: data.instance, namespace: data.namespace, instances, limits: parseLimits(data.limits) }
    }
    case 'msg':
      if (!isText(data.id, REQUEST_ID) || !isInstanceId(data.from) || typeof data.to !== 'string' || !isText(data.kind, KIND)) return null
      return { t: 'msg', id: data.id, from: data.from, to: data.to, kind: data.kind, body: data.body }
    case 'invite':
      if (!isText(data.re, REQUEST_ID) || typeof data.code !== 'string' || data.code.length > 64 || !isTime(data.expiresAt)) return null
      return { t: 'invite', re: data.re, code: data.code, expiresAt: data.expiresAt }
    case 'instances': {
      const instances = parseInstances(data.instances)
      if (!isText(data.re, REQUEST_ID) || !instances) return null
      return { t: 'instances', re: data.re, instances }
    }
    case 'ok':
      return isText(data.re, REQUEST_ID) ? { t: 'ok', re: data.re } : null
    case 'instance': {
      const instance = parseInstanceInfo(data.instance)
      const event = INSTANCE_EVENTS.find((e) => e === data.event)
      return instance && event ? { t: 'instance', event, instance } : null
    }
    case 'removed':
      return isInstanceId(data.instance) ? { t: 'removed', instance: data.instance } : null
    case 'error': {
      const code = ERROR_CODES.find((c) => c === data.code) ?? 'internal'
      const re = isText(data.re, REQUEST_ID) ? data.re : undefined
      const message = typeof data.message === 'string' ? data.message.slice(0, 500) : ''
      return re === undefined ? { t: 'error', code, message } : { t: 'error', re, code, message }
    }
    default:
      return null
  }
}
