/**
 * The admin CLI: `serve` and the commands for namespaces, invites and instances. They work on the same
 * database as a running server, so the admin needs no web interface and no extra credentials; whoever
 * can run this has the server anyway.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, loadConfig, type Config } from './config.ts'
import { createLogger } from './log.ts'
import type { Role } from './protocol.ts'
import { VERSION, startServer } from './server.ts'
import { Store, StoreError } from './store.ts'

export const DB_FILE = 'nexa-server.db'
const ADMIN_INVITE_TTL_MS = 7 * 24 * 60 * 60_000

export interface CliIo {
  out(line: string): void
  err(line: string): void
  env: NodeJS.ProcessEnv
  /** When `serve` should stop; SIGINT or SIGTERM by default. */
  untilStop?: () => Promise<void>
}

const defaultIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  env: process.env,
}

class UsageError extends Error {}

const HELP = `nexa-server ${VERSION}: Relay für Nexa, Remote Control zwischen den eigenen Geräten

Aufruf: nexa-server <Befehl>

Befehle:
  serve                           Server starten
  namespace create <name>         Namespace anlegen und den ersten Einladungscode ausgeben
  namespace list                  Namespaces mit der Zahl ihrer Instanzen
  namespace delete <name> --yes   Namespace mit allen Instanzen und Einladungen löschen
  invite <namespace>              Neuen Einladungscode ausgeben, 7 Tage gültig
  instances <namespace>           Instanzen eines Namespace
  instance remove <id> --yes      Instanz entfernen; das Gerät muss danach neu gekoppelt werden
  version                         Version ausgeben
  help                            Diese Hilfe

Einstellungen kommen aus Umgebungsvariablen (siehe README.md):
  NEXA_HOST, NEXA_PORT, NEXA_DATA_DIR, NEXA_MAX_MESSAGE_KB, NEXA_MAX_INSTANCES,
  NEXA_RATE_LIMIT, NEXA_LOG_LEVEL`

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  const flags = new Set(args.filter((arg) => arg.startsWith('-')))
  const words = args.filter((arg) => !arg.startsWith('-'))
  try {
    for (const flag of flags) {
      if (!['--yes', '--help', '-h', '--version', '-v'].includes(flag)) throw new UsageError(`Unbekannte Option „${flag}“.`)
    }
    if (flags.has('--version') || flags.has('-v') || words[0] === 'version') {
      io.out(VERSION)
      return 0
    }
    if (flags.has('--help') || flags.has('-h') || words.length === 0 || words[0] === 'help') {
      io.out(HELP)
      return 0
    }
    const yes = flags.has('--yes')
    const [command, sub, arg] = words
    const config = loadConfig(io.env)

    switch (command) {
      case 'serve':
        expectArgs(words, 1)
        return await serve(config, io)
      case 'namespace':
        expectArgs(words, sub === 'list' ? 2 : 3)
        if (sub === 'create') return withStore(config, (store) => createNamespace(store, need(arg, '<name>'), io))
        if (sub === 'list') return withStore(config, (store) => listNamespaces(store, io))
        if (sub === 'delete') return withStore(config, (store) => deleteNamespace(store, need(arg, '<name>'), yes, io))
        throw new UsageError('Erwartet: namespace create|list|delete')
      case 'invite':
        expectArgs(words, 2)
        return withStore(config, (store) => invite(store, need(sub, '<namespace>'), io))
      case 'instances':
        expectArgs(words, 2)
        return withStore(config, (store) => listInstances(store, need(sub, '<namespace>'), io))
      case 'instance':
        expectArgs(words, 3)
        if (sub === 'remove') return withStore(config, (store) => removeInstance(store, need(arg, '<id>'), yes, io))
        throw new UsageError('Erwartet: instance remove <id> --yes')
      default:
        throw new UsageError(`Unbekannter Befehl „${command}“.`)
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\nHilfe: nexa-server help`)
      return 2
    }
    if (error instanceof ConfigError || error instanceof StoreError) {
      io.err(error.message)
      return 1
    }
    io.err(`Fehler: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

// --- serve ----------------------------------------------------------------------------------------

async function serve(config: Config, io: CliIo): Promise<number> {
  const log = createLogger(config.logLevel)
  const store = openStore(config)
  let server
  try {
    server = await startServer({ config, store, log })
  } catch (error) {
    store.close()
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') throw new ConfigError(`Port ${config.port} ist schon belegt (NEXA_PORT).`)
    if (code === 'EADDRNOTAVAIL') throw new ConfigError(`Die Adresse „${config.host}“ gibt es hier nicht (NEXA_HOST).`)
    throw error
  }
  log.info(`nexa-server ${VERSION} läuft auf ${server.url}, Daten in ${config.dataDir}`)
  if (config.pwa) log.info(`Web-App unter ${server.url}/app/`)
  await (io.untilStop ?? untilSignal)()
  log.info('Fahre herunter …')
  await server.close()
  store.close()
  log.info('Beendet.')
  return 0
}

function untilSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}

// --- Namespaces and invites -----------------------------------------------------------------------

function createNamespace(store: Store, name: string, io: CliIo): number {
  store.createNamespace(name)
  const code = store.createInvite(name, ADMIN_INVITE_TTL_MS)
  io.out(`Namespace „${name}“ angelegt.\n`)
  printInvite(code.code, code.expiresAt, io)
  return 0
}

function invite(store: Store, namespace: string, io: CliIo): number {
  const code = store.createInvite(namespace, ADMIN_INVITE_TTL_MS)
  printInvite(code.code, code.expiresAt, io)
  return 0
}

function printInvite(code: string, expiresAt: number, io: CliIo): void {
  io.out(`Einladungscode, gilt einmal und bis ${formatDate(expiresAt)}:\n`)
  io.out(`    ${code}\n`)
  io.out('In Nexa zusammen mit der Adresse dieses Servers eintragen. Der Server speichert den Code nicht')
  io.out('lesbar, er steht nur hier.')
}

function listNamespaces(store: Store, io: CliIo): number {
  const namespaces = store.listNamespaces()
  if (namespaces.length === 0) {
    io.out('Noch keine Namespaces. Anlegen mit: nexa-server namespace create <name>')
    return 0
  }
  const rows = namespaces.map((ns) => [ns.name, String(ns.instances), String(store.countInvites(ns.name)), formatDate(ns.createdAt)])
  for (const line of table([['Name', 'Instanzen', 'Einladungen', 'Angelegt'], ...rows])) io.out(line)
  return 0
}

function deleteNamespace(store: Store, name: string, yes: boolean, io: CliIo): number {
  const namespace = store.getNamespace(name)
  if (!namespace) throw new StoreError('namespace-unknown', `Den Namespace „${name}“ gibt es nicht.`)
  if (!yes) {
    io.err(
      namespace.instances === 0
        ? `„${name}“ hat keine Instanzen; offene Einladungen verfallen.`
        : `„${name}“ hat ${count(namespace.instances, 'Instanz', 'Instanzen')}, die ihre Kopplung verlieren; offene Einladungen verfallen.`,
    )
    io.err(`Zum Löschen: nexa-server namespace delete ${name} --yes`)
    return 1
  }
  store.deleteNamespace(name)
  io.out(`Namespace „${name}“ gelöscht. Verbundene Instanzen trennt der laufende Server spätestens nach 30 Sekunden.`)
  return 0
}

// --- Instances ------------------------------------------------------------------------------------

const ROLE_LABELS: Record<Role, string> = { host: 'Host', controller: 'Steuerung' }

function listInstances(store: Store, namespace: string, io: CliIo): number {
  if (!store.hasNamespace(namespace)) {
    throw new StoreError('namespace-unknown', `Den Namespace „${namespace}“ gibt es nicht.`)
  }
  const instances = store.listInstances(namespace)
  if (instances.length === 0) {
    io.out(`„${namespace}“ hat noch keine Instanzen. Einladung: nexa-server invite ${namespace}`)
    return 0
  }
  const now = Date.now()
  const rows = instances.map((instance) => [
    instance.id,
    instance.name,
    ROLE_LABELS[instance.role],
    instance.lastSeen === null ? 'nie' : ago(instance.lastSeen, now),
    formatDate(instance.createdAt),
  ])
  for (const line of table([['ID', 'Name', 'Rolle', 'Zuletzt gesehen', 'Angelegt'], ...rows])) io.out(line)
  io.out('\nVerbundene Instanzen melden sich alle 30 Sekunden; „gerade eben“ heißt also meist: online.')
  return 0
}

function removeInstance(store: Store, id: string, yes: boolean, io: CliIo): number {
  const instance = store.getInstance(id)
  if (!instance) {
    io.err(`Eine Instanz „${id}“ gibt es nicht.`)
    return 1
  }
  const label = `Instanz „${instance.name}“ (${ROLE_LABELS[instance.role]}) aus dem Namespace „${instance.namespace}“`
  if (!yes) {
    io.err(`Das entfernt die ${label}; das Gerät muss danach neu gekoppelt werden.`)
    io.err(`Zum Entfernen: nexa-server instance remove ${id} --yes`)
    return 1
  }
  store.removeInstance(id)
  io.out(`${label} entfernt. Ist sie verbunden, trennt der laufende Server sie spätestens nach 30 Sekunden.`)
  return 0
}

// --- Helpers --------------------------------------------------------------------------------------

function openStore(config: Config): Store {
  mkdirSync(config.dataDir, { recursive: true })
  return new Store(join(config.dataDir, DB_FILE), { maxInstances: config.maxInstances })
}

function withStore(config: Config, fn: (store: Store) => number): number {
  const store = openStore(config)
  try {
    return fn(store)
  } finally {
    store.close()
  }
}

function need(value: string | undefined, name: string): string {
  if (!value) throw new UsageError(`${name} fehlt.`)
  return value
}

function expectArgs(words: string[], max: number): void {
  if (words.length > max) throw new UsageError(`Zu viele Argumente: „${words.slice(max).join(' ')}“.`)
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

function formatDate(ms: number): string {
  return dateFormat.format(ms)
}

const relative = new Intl.RelativeTimeFormat('de', { numeric: 'auto' })

function ago(ms: number, now: number): string {
  const seconds = Math.round((now - ms) / 1000)
  if (seconds < 60) return 'gerade eben'
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return relative.format(-Math.floor(seconds / 3600), 'hour')
  if (seconds < 7 * 86_400) return relative.format(-Math.floor(seconds / 86_400), 'day')
  return formatDate(ms)
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)))
  return rows.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!))).join('  '))
}
