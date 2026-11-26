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
}

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
  }
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
