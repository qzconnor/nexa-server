/** Settings from environment variables; `README.md` lists them for operators. */

import { resolve } from 'node:path'
import { LOG_LEVELS, type LogLevel } from './log.ts'

export interface Config {
  host: string
  port: number
  dataDir: string
  /** Largest WebSocket message; a larger one closes the connection with 1009. */
  maxMessageBytes: number
  maxInstances: number
  /** Messages per second and connection; bursts up to twice as many. */
  rateLimit: number
  logLevel: LogLevel
  /** Serve the web app at `/app`; off by default, see README („Web-App“). Push comes with it. */
  pwa: boolean
  /** How push services reach the operator (`sub` of VAPID): `mailto:` or `https:`. */
  vapidSubject: string
}

/** Without an address of the operator: the project's, a valid `https:` that push services accept. */
export const DEFAULT_VAPID_SUBJECT = 'https://github.com/qzconnor/nexa-server'

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const logLevel = (env.NEXA_LOG_LEVEL || 'info') as LogLevel
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`NEXA_LOG_LEVEL muss ${LOG_LEVELS.join(', ')} sein, ist „${logLevel}“.`)
  }
  return {
    // Loopback unless told otherwise: without a TLS proxy in front, invite codes would go over plain HTTP.
    host: env.NEXA_HOST || '127.0.0.1',
    port: integer(env, 'NEXA_PORT', 8080, 0, 65535),
    dataDir: resolve(env.NEXA_DATA_DIR || 'data'),
    maxMessageBytes: integer(env, 'NEXA_MAX_MESSAGE_KB', 1024, 1, 64 * 1024) * 1024,
    maxInstances: integer(env, 'NEXA_MAX_INSTANCES', 20, 1, 1000),
    rateLimit: integer(env, 'NEXA_RATE_LIMIT', 100, 1, 100_000),
    logLevel,
    pwa: flag(env, 'NEXA_PWA'),
    vapidSubject: vapidSubject(env),
  }
}

function vapidSubject(env: NodeJS.ProcessEnv): string {
  const raw = env.NEXA_VAPID_SUBJECT?.trim()
  if (!raw) return DEFAULT_VAPID_SUBJECT
  // Apple refuses anything else, and refuses the push, not the setting: say so at the start.
  if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) && !/^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/.test(raw)) {
    throw new ConfigError(`NEXA_VAPID_SUBJECT muss „mailto:name@domain“ oder eine https-Adresse sein, ist „${raw}“.`)
  }
  return raw
}

function flag(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (raw === undefined || raw === '' || ['0', 'false', 'off', 'no'].includes(raw)) return false
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true
  throw new ConfigError(`${name} muss „true“ oder „false“ sein, ist „${env[name]}“.`)
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} muss eine ganze Zahl von ${min} bis ${max} sein, ist „${raw}“.`)
  }
  return value
}
