/**
 * Plain log lines on stdout/stderr, for `docker logs`. Never pass the `body` of a message or a whole
 * message here: the server is blind on purpose and its log must not undo that.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

export interface Logger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export function createLogger(level: LogLevel): Logger {
  const min = LOG_LEVELS.indexOf(level)
  const line = (at: LogLevel, message: string): void => {
    if (LOG_LEVELS.indexOf(at) < min) return
    const text = `${new Date().toISOString()} ${at.toUpperCase().padEnd(5)} ${message}\n`
    if (at === 'warn' || at === 'error') process.stderr.write(text)
    else process.stdout.write(text)
  }
  return {
    debug: (message) => line('debug', message),
    info: (message) => line('info', message),
    warn: (message) => line('warn', message),
    error: (message) => line('error', message),
  }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
