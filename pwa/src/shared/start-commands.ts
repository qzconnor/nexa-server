import type { ShellStatus } from './chat'
import { inFolder, TRAILING_SEPARATORS } from './folders'
import type { Project, ShellOutput, StartCommand } from './types'

/**
 * Start commands: shells a project runs beside its chats, e.g. its dev server (`npm run dev`), as the
 * shells of the Claude Manager's tab sets with their start command. Saved with the project
 * (`Project.startCommands`), run by Nexa in the shell of the settings (main `services/start-commands.ts`).
 */

type Unsubscribe = () => void

/** More than any project needs at once; the menus list them all. */
export const MAX_START_COMMANDS = 20
export const MAX_START_COMMAND_NAME = 80
/** A command is one line, as in the Claude Manager's tab sets. */
export const MAX_START_COMMAND_LENGTH = 2000

const ID_RE = /^[\w-]{1,64}$/

/** A start command that runs, or ran since Nexa started: its last run. */
export interface StartCommandRun {
  projectId: string
  commandId: string
  /** Name, command and folder it started with: a change counts from its next start. */
  name: string
  command: string
  cwd: string
  /** The shell it runs in: „PowerShell 7“, „Git Bash“ …; empty when it couldn't start. */
  shell: string
  status: ShellStatus
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  /** Why it couldn't start (folder or shell missing), or how it failed. */
  error?: string
}

export const StartCommandsInvoke = {
  runs: 'start-commands:runs',
  save: 'start-commands:save',
  start: 'start-commands:start',
  stop: 'start-commands:stop',
  restart: 'start-commands:restart',
  output: 'start-commands:output',
  chatOpened: 'start-commands:chat-opened',
} as const

export const StartCommandsEvent = {
  /** A run started or ended, or went with its command. */
  changed: 'event:start-commands-changed',
} as const

export interface StartCommandsApi {
  /** The runs since Nexa started, the last one of each command. */
  runs(): Promise<StartCommandRun[]>
  /** Replaces the project's start commands; one that runs and is gone ends. */
  save(projectId: string, commands: StartCommand[]): Promise<Project>
  /** Starts it in its folder; one that runs stays as it is. */
  start(projectId: string, commandId: string): Promise<void>
  stop(projectId: string, commandId: string): Promise<void>
  /** Ends it and starts it again, as it is saved now. */
  restart(projectId: string, commandId: string): Promise<void>
  /** The end of what its last run wrote. */
  output(projectId: string, commandId: string): Promise<ShellOutput>
  /** A chat of the project is on screen: the first one starts its commands with `autoStart`. */
  chatOpened(projectId: string): Promise<void>
  onChanged(cb: (runs: StartCommandRun[]) => void): Unsubscribe
}

export function startCommandKey(projectId: string, commandId: string): string {
  return `${projectId}/${commandId}`
}

/** What a start command is called: its name, else its command. */
export function startCommandLabel(command: Pick<StartCommand, 'name' | 'command'>): string {
  return command.name.trim() || command.command.trim()
}

/** Why `name` can't name a start command; null when it can (also when empty). */
export function startCommandNameError(name: string): string | null {
  return name.trim().length > MAX_START_COMMAND_NAME ? `Der Name ist zu lang (höchstens ${MAX_START_COMMAND_NAME} Zeichen).` : null
}

/** Why `command` can't be run as a start command; null when it can. */
export function startCommandError(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed) return 'Gib den Befehl an, z. B. npm run dev.'
  if (/[\r\n]/.test(trimmed)) return 'Der Befehl ist eine Zeile.'
  if (trimmed.length > MAX_START_COMMAND_LENGTH) return `Der Befehl ist zu lang (höchstens ${MAX_START_COMMAND_LENGTH} Zeichen).`
  return null
}

/**
 * A folder in the project as it is saved: relative, with `/`, without `.` (`''`: the project's own).
 * Null for one that leaves the project: absolute, or up with `..`.
 */
export function normalizeStartDir(dir: string): string | null {
  const trimmed = dir.trim()
  if (/^(?:[a-z]:|[\\/]|~)/i.test(trimmed)) return null
  const parts = trimmed.split(/[\\/]+/).filter((part) => part && part !== '.')
  return parts.includes('..') ? null : parts.join('/')
}

/** `path` relative to `folder`, with `/` (`''`: the folder itself); null when it lies outside. */
export function relativeDir(folder: string, path: string): string | null {
  if (!inFolder(path, folder)) return null
  const base = folder.trim().replace(TRAILING_SEPARATORS, '')
  return path
    .trim()
    .slice(base.length)
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/')
}

/**
 * A project's start commands from the window, checked and trimmed, without empty fields. Throws, in
 * words for the dialog, when one doesn't fit.
 */
export function parseStartCommands(value: unknown): StartCommand[] {
  if (!Array.isArray(value)) throw new Error('Die Startbefehle fehlen.')
  if (value.length > MAX_START_COMMANDS) throw new Error(`Ein Projekt hat höchstens ${MAX_START_COMMANDS} Startbefehle.`)
  const ids = new Set<string>()
  return value.map((entry, i): StartCommand => {
    const c = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const which = `Startbefehl ${i + 1}`
    if (typeof c.id !== 'string' || !ID_RE.test(c.id) || ids.has(c.id)) throw new Error(`${which} hat keine gültige ID.`)
    ids.add(c.id)
    const name = typeof c.name === 'string' ? c.name.trim() : ''
    const command = typeof c.command === 'string' ? c.command.trim() : ''
    const error = startCommandNameError(name) ?? startCommandError(command)
    if (error) throw new Error(`${which}: ${error}`)
    const dir = typeof c.dir === 'string' ? normalizeStartDir(c.dir) : ''
    if (dir === null) throw new Error(`${which}: Der Ordner „${String(c.dir).trim()}“ liegt nicht im Projekt.`)
    return { id: c.id, name, command, ...(dir ? { dir } : {}), ...(c.autoStart === true ? { autoStart: true } : {}) }
  })
}
