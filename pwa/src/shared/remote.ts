/**
 * Remote Control between two paired devices (docs/NEXA-SERVER.md, „Remote Control“): a controlling
 * device uses the other one as if it sat in front of it. Its window makes the calls it makes of its own
 * main process (`IpcInvoke`), they go to the host (`invoke`), and the host answers them with its own
 * handlers; the host's events for its windows (`IpcEvent`) come back the same way (`rc.events`). The
 * messages go sealed for the pair and signed (`main/server-link/device-channel.ts`); the host checks
 * every call itself, against the list below and the level it gives the asking device.
 */

import type { ChatItem, InteractionResponse, PermissionMode, SessionEvent } from './chat'
import { FilesEvent, FilesInvoke } from './files-ipc'
import { IpcEvent, IpcInvoke } from './ipc'
import { McpAppsInvoke } from './mcp-apps'
import { CHAT_METHOD_LEVEL, parseChatRequest, type RemoteChatMethods } from './remote-chats'
import type { SessionCreateInput, SessionUpdateInput } from './types'

/** `kind`s of Remote Control messages; the server sees them in plain text. */
export const RemoteKind = {
  /** Controller → host: `{ m, p }`, answered by a `response` naming its id. */
  request: 'rc.request',
  /** Host → controller: `{ re, r }` or `{ re, e }`. */
  response: 'rc.response',
  /** Host → controller: `{ events }`, while the controller watches (`watch`). */
  events: 'rc.events',
} as const

/** What a host lets another device do; each level includes the ones before it. */
export type RemoteLevel = 'off' | 'read' | 'prompt' | 'full'
export const REMOTE_LEVELS: readonly RemoteLevel[] = ['off', 'read', 'prompt', 'full']
/** A device the user hasn't given a level yet: it may look, not act. */
export const DEFAULT_REMOTE_LEVEL: RemoteLevel = 'read'

export const REMOTE_LEVEL_LABELS: Record<RemoteLevel, string> = {
  off: 'Aus',
  read: 'Nur mitlesen',
  prompt: 'Prompts senden und Chats ordnen',
  full: 'Alles, wie am Gerät selbst',
}

export function isRemoteLevel(value: unknown): value is RemoteLevel {
  return typeof value === 'string' && (REMOTE_LEVELS as readonly string[]).includes(value)
}

export function levelAllows(level: RemoteLevel, needed: RemoteLevel): boolean {
  return REMOTE_LEVELS.indexOf(level) >= REMOTE_LEVELS.indexOf(needed)
}

/** The host as it answers `hello` and `watch`: whether it lets anyone in, and how far the asking device. */
export interface RemoteHostInfo {
  name: string
  /** Remote Control is on at the host (Einstellungen › Geräte). */
  enabled: boolean
  /** What the host lets the asking device do; `off` while Remote Control is off. */
  level: RemoteLevel
  /** Nexa's version at the host. */
  version: string
}

/** The requests, with what each takes and returns; those of the agents' chat tools in remote-chats.ts. */
export interface RemoteMethods extends RemoteChatMethods {
  hello: { params: Record<string, never>; result: RemoteHostInfo }
  /**
   * The host's events come as `rc.events` from now on, those of the chats in `ids` with their items
   * and streamed text; replaces the last set and lasts `WATCH_TTL_MS`, so it is renewed while the
   * device shows the host. `renewed` false: the host had no watch of this device (it restarted, or the
   * last one ran out or lost events), and what happened meanwhile came as no event: read it anew.
   * `fresh`: the device has nothing of before, its list events start whole (`ListDiff`).
   */
  watch: { params: { ids: string[]; fresh?: boolean }; result: RemoteHostInfo & { renewed: boolean } }
  unwatch: { params: Record<string, never>; result: null }
  /** A call of the host's window API (`IpcInvoke`), as far as `channelLevel` lets it through. */
  invoke: { params: { ch: string; args: unknown[] }; result: unknown }
}
export type RemoteMethod = keyof RemoteMethods

/** The level each request needs; null: every member may ask (to learn its level, or to stop). `invoke`: by channel. */
export const METHOD_LEVEL: Record<RemoteMethod, RemoteLevel | null> = {
  hello: null,
  watch: 'read',
  unwatch: null,
  invoke: null,
  ...CHAT_METHOD_LEVEL,
}

/** A watch lasts this long unless renewed; the controller renews it every `WATCH_RENEW_MS`. */
export const WATCH_TTL_MS = 90_000
export const WATCH_RENEW_MS = 30_000
/** At most this many chats send their items to one device at a time (`watch`). */
export const MAX_WATCHED_CHATS = 32

// --- What another device may call -------------------------------------------------------------------

type ChannelRule = RemoteLevel | ((args: readonly unknown[]) => RemoteLevel)

/** How the chat's agent runs: changing it is the host's own business, the full level's. */
const AGENT_FIELDS: readonly string[] = ['provider', 'account', 'model', 'effort', 'ultracode', 'permissionMode', 'dirs'] satisfies (keyof SessionUpdateInput)[]
/** Modes in which the agent asks before it acts: a chat that starts in them is just a prompt. */
const ASKING_MODES: readonly (PermissionMode | undefined)[] = [undefined, 'ask', 'plan']

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * The items of a chat before one of them (`[sessionId, itemId]` → `RemoteItems`): another device gets a
 * long chat's newest items when it opens it (`sessions:open`), the ones before as it scrolls up. Only
 * over Remote Control: this device's own windows have all of a chat's items.
 */
export const SESSIONS_OLDER = 'sessions:older'

/**
 * The calls of the window API another device may make here, with the level each takes: what the chat
 * window, its dock and the sidebar need, nothing of the host's own windows, dialogs or terminals, and
 * of its files only those in the folders of its chats (the file panel; main/files/files-ipc.ts checks
 * every path). Renaming, pinning and arranging chats is ordering them; how an agent runs (model,
 * permissions, CLI arguments), what it may do (answers to its questions) and changing files is the
 * full level's.
 */
const CHANNELS: Record<string, ChannelRule> = {
  [IpcInvoke.settingsGet]: 'read',
  [IpcInvoke.settingsUpdate]: 'full',
  [IpcInvoke.providersList]: 'read',
  [IpcInvoke.providersRefresh]: 'prompt',
  [IpcInvoke.providersModels]: 'read',
  [IpcInvoke.providersModelDefaults]: 'read',
  [IpcInvoke.providersCommands]: 'read',
  [IpcInvoke.usageGet]: 'read',
  [IpcInvoke.usageRefresh]: 'prompt',
  [IpcInvoke.accountsList]: 'read',
  [IpcInvoke.accountsLogins]: 'read',
  [IpcInvoke.projectsList]: 'read',
  [IpcInvoke.projectsUpdate]: 'prompt',
  [IpcInvoke.projectsArrange]: 'prompt',
  [IpcInvoke.projectsRemove]: 'full',
  [IpcInvoke.sectionsList]: 'read',
  [IpcInvoke.sectionsCreate]: 'prompt',
  [IpcInvoke.sectionsUpdate]: 'prompt',
  [IpcInvoke.sectionsRemove]: 'prompt',
  [IpcInvoke.sessionsList]: 'read',
  [IpcInvoke.sessionsRuntimes]: 'read',
  [IpcInvoke.sessionsOpen]: 'read',
  [SESSIONS_OLDER]: 'read',
  [IpcInvoke.sessionsContext]: 'read',
  [IpcInvoke.sessionsMcpServers]: 'read',
  [IpcInvoke.sessionsPlugins]: 'read',
  [IpcInvoke.sessionsShellOutput]: 'read',
  [IpcInvoke.sessionsLastAnswer]: 'read',
  // A picture of the chat's prompts (only those), as bytes (base64).
  [IpcInvoke.sessionsImage]: 'read',
  // The pages of MCP tools (MCP Apps): the page and what it reads; a tool it calls acts as the agent would.
  [McpAppsInvoke.page]: 'read',
  [McpAppsInvoke.readResource]: 'read',
  [McpAppsInvoke.callTool]: 'full',
  [IpcInvoke.sessionsChanges]: 'read',
  [IpcInvoke.sessionsChangeDiff]: 'read',
  [IpcInvoke.sessionsRewindPreview]: 'read',
  [IpcInvoke.sessionsSearch]: 'read',
  [IpcInvoke.sessionsCreate]: (args) => {
    const input = record(args[0]) as Partial<SessionCreateInput>
    return input.cliArgs?.length || !ASKING_MODES.includes(input.permissionMode) ? 'full' : 'prompt'
  },
  [IpcInvoke.sessionsSend]: 'prompt',
  [IpcInvoke.sessionsEdit]: 'prompt',
  [IpcInvoke.sessionsInterrupt]: 'prompt',
  [IpcInvoke.sessionsSync]: 'prompt',
  // Looking at a chat: whoever may read it may have read it.
  [IpcInvoke.sessionsSeen]: 'read',
  // The phone's inbox (shared/inbox.ts); no window of the app asks for it.
  [IpcInvoke.sessionsInbox]: 'read',
  [IpcInvoke.sessionsCompact]: 'prompt',
  [IpcInvoke.sessionsFork]: 'prompt',
  [IpcInvoke.sessionsClear]: 'prompt',
  [IpcInvoke.sessionsMove]: 'prompt',
  [IpcInvoke.sessionsStop]: 'prompt',
  [IpcInvoke.sessionsRestart]: 'prompt',
  [IpcInvoke.sessionsResumeAtReset]: 'prompt',
  [IpcInvoke.sessionsUpdate]: (args) => (Object.keys(record(args[1])).some((key) => AGENT_FIELDS.includes(key)) ? 'full' : 'prompt'),
  [IpcInvoke.sessionsRespond]: 'full',
  [IpcInvoke.sessionsRunShell]: 'full',
  [IpcInvoke.sessionsStopShell]: 'full',
  [IpcInvoke.sessionsSetMcp]: 'full',
  [IpcInvoke.sessionsReconnectMcp]: 'full',
  [IpcInvoke.sessionsSetPlugin]: 'full',
  [IpcInvoke.sessionsRemove]: 'full',
  // Writes and deletes files in the chat's folders.
  [IpcInvoke.sessionsRewind]: 'full',
  [IpcInvoke.sessionsRewindUndo]: 'full',
  // The file panel beside the chat: its tree, the changes, a file's diff, the search (also the names
  // for `@` in the composer), the branch; watched while it shows them.
  [FilesInvoke.list]: 'read',
  [FilesInvoke.status]: 'read',
  [FilesInvoke.searchList]: 'read',
  [FilesInvoke.watch]: 'read',
  [FilesInvoke.diff]: 'read',
  [FilesInvoke.reviewBase]: 'read',
  [FilesInvoke.grep]: 'read',
  [FilesInvoke.history]: 'read',
  [FilesInvoke.gitBranch]: 'read',
  [FilesInvoke.gitWatch]: 'read',
  [FilesInvoke.gitWebUrl]: 'read',
  [FilesInvoke.gitMainWorktree]: 'read',
  // Changes the files: new, renamed and trashed entries, what git stages and discards.
  [FilesInvoke.create]: 'full',
  [FilesInvoke.rename]: 'full',
  [FilesInvoke.trash]: 'full',
  [FilesInvoke.stage]: 'full',
  [FilesInvoke.unstage]: 'full',
  [FilesInvoke.discard]: 'full',
  [FilesInvoke.hunk]: 'full',
  // A picture for a prompt, as bytes (base64): the host keeps it with its own attachments.
  [IpcInvoke.appSaveImage]: 'prompt',
}

/** The level a call of the window API takes when another device makes it; null: not over Remote Control. */
export function channelLevel(ch: string, args: readonly unknown[]): RemoteLevel | null {
  const rule = Object.hasOwn(CHANNELS, ch) ? CHANNELS[ch] : undefined
  if (rule === undefined) return null
  return typeof rule === 'function' ? rule(args) : rule
}

/**
 * The host's window events another device gets while it watches: a chat's own (its items, the files
 * its agent touches) only for its open chats, a folder's changes and branch only for the folders it
 * watches (`files:watch`, `git:watch`).
 */
export const REMOTE_EVENTS: ReadonlySet<string> = new Set<string>([
  IpcEvent.settingsChanged,
  IpcEvent.providersChanged,
  IpcEvent.accountsChanged,
  IpcEvent.usageChanged,
  IpcEvent.projectsChanged,
  IpcEvent.sectionsChanged,
  IpcEvent.sessionsChanged,
  IpcEvent.sessionEvent,
  FilesEvent.changed,
  FilesEvent.touched,
  FilesEvent.gitBranchChanged,
])

/**
 * Events whose one argument is the whole list of something with an `id`: they go as what changed since
 * the last one (`ListDiff`); the list of chats alone changes with every turn.
 */
export const LIST_EVENTS: ReadonlySet<string> = new Set<string>([IpcEvent.accountsChanged, IpcEvent.projectsChanged, IpcEvent.sectionsChanged, IpcEvent.sessionsChanged])

/** A list event as the change against the one before: every id in order, the entries new or changed. */
export interface ListDiff {
  ids: string[]
  changed: { id: string }[]
}

/** What `rc.events` carries: a window event of the host, or a list event as a change. */
export type RemoteEvent = { ch: string; args: unknown[] } | { ch: string; diff: ListDiff }

/** A window event as the controller's window gets it, whole again. */
export interface RemoteBroadcast {
  ch: string
  args: unknown[]
}

/** The change from `before` (entries by id, as JSON) to `list`; null when `list` isn't a list of entries with ids. */
export function diffList(list: unknown, before: ReadonlyMap<string, string>): { diff: ListDiff; next: Map<string, string> } | null {
  if (!Array.isArray(list) || !list.every((e) => typeof record(e).id === 'string')) return null
  const next = new Map<string, string>()
  const changed: { id: string }[] = []
  for (const entry of list as { id: string }[]) {
    const json = JSON.stringify(entry)
    next.set(entry.id, json)
    if (before.get(entry.id) !== json) changed.push(entry)
  }
  return { diff: { ids: [...next.keys()], changed }, next }
}

/** The list again from the one before (by id) and a change; null when an entry is in neither. */
export function applyDiff(diff: ListDiff, before: ReadonlyMap<string, { id: string }>): { id: string }[] | null {
  const changed = new Map(diff.changed.map((e) => [e.id, e]))
  const list: { id: string }[] = []
  for (const id of diff.ids) {
    const entry = changed.get(id) ?? before.get(id)
    if (entry === undefined) return null
    list.push(entry)
  }
  return list
}

// --- Errors ------------------------------------------------------------------------------------------

export type RemoteErrorCode =
  /** Remote Control is off at the host. */
  | 'disabled'
  /** The host doesn't let this device do that. */
  | 'forbidden'
  | 'not-found'
  | 'bad-request'
  /** The message would be larger than the devices pass on. */
  | 'too-large'
  /** The host tried, and it went wrong; `message` says why, in German. */
  | 'failed'
  /** On the controlling side: the host isn't connected, didn't answer, or this device isn't. */
  | 'unreachable'
  /** The host is connected but doesn't keep up with reading (the server said `busy`). */
  | 'busy'
  /** The server knows no such device (any more): it was removed. */
  | 'gone'
  | 'timeout'
  | 'offline'

export interface RemoteErrorBody {
  code: RemoteErrorCode
  message: string
}

export type RemoteResponse = { re: string; r: unknown } | { re: string; e: RemoteErrorBody }

/** For the user, by code; `failed` brings the host's own words. */
export function remoteErrorText(error: RemoteErrorBody): string {
  switch (error.code) {
    case 'disabled':
      return 'Auf dem anderen Gerät ist die Fernsteuerung aus. Schalte sie dort unter Einstellungen › Geräte ein.'
    case 'forbidden':
      return 'Das darf dieses Gerät dort nicht. Mehr gibst du am anderen Gerät unter Einstellungen › Geräte frei.'
    case 'not-found':
      return 'Das gibt es auf dem anderen Gerät nicht.'
    case 'bad-request':
      return 'Das andere Gerät hat die Anfrage nicht verstanden. Läuft dort eine andere Version von Nexa?'
    case 'too-large':
      return 'Das ist zu groß, um es zwischen den Geräten zu schicken.'
    case 'unreachable':
      return 'Das Gerät ist gerade nicht verbunden.'
    case 'busy':
      return 'Das Gerät kommt gerade nicht hinterher. Versuch es gleich noch einmal.'
    case 'gone':
      return 'Das Gerät gibt es beim Server nicht mehr.'
    case 'timeout':
      return 'Das Gerät hat nicht geantwortet.'
    case 'offline':
      return 'Dieses Gerät ist nicht mit dem Server verbunden.'
    case 'failed':
      return error.message
  }
}

const REMOTE_ERROR_CODES = new Set<string>(['disabled', 'forbidden', 'not-found', 'bad-request', 'too-large', 'failed', 'unreachable', 'busy', 'gone', 'timeout', 'offline'])

// --- Parsing what comes over the relay -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
/** Channels as `IpcInvoke` names them: `sessions:open`, `files:search-list`. */
const CHANNEL = /^[a-z][a-z0-9-]{0,31}:[a-z0-9-]{1,64}$/
/** Arguments of one call: the window API takes at most a few. */
const MAX_ARGS = 8

export type RemoteRequest = { [M in RemoteMethod]: { m: M; p: RemoteMethods[M]['params'] } }[RemoteMethod]

/** A request as the host takes it, its parameters checked; null when it isn't one. */
export function parseRemoteRequest(data: unknown): RemoteRequest | null {
  if (!isRecord(data) || typeof data.m !== 'string') return null
  const p = isRecord(data.p) ? data.p : {}
  switch (data.m) {
    case 'hello':
    case 'unwatch':
      return { m: data.m, p: {} }
    case 'watch': {
      if (!Array.isArray(p.ids) || p.ids.length > MAX_WATCHED_CHATS || !p.ids.every(isId)) return null
      return { m: 'watch', p: { ids: [...new Set(p.ids as string[])], ...(p.fresh === true ? { fresh: true } : {}) } }
    }
    case 'invoke': {
      if (typeof p.ch !== 'string' || !CHANNEL.test(p.ch) || !Array.isArray(p.args) || p.args.length > MAX_ARGS) return null
      return { m: 'invoke', p: { ch: p.ch, args: p.args } }
    }
    default:
      return parseChatRequest(data.m, p)
  }
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

/** An answer to a question of the agent, in one of the shapes the chat sends; null otherwise. */
export function parseInteractionResponse(value: unknown): InteractionResponse | null {
  if (!isRecord(value)) return null
  const optional = (v: unknown) => v === undefined || typeof v === 'string'
  switch (value.type) {
    case 'permission':
      if (!['allow', 'allow-session', 'deny'].includes(value.decision as string) || !optional(value.message)) return null
      return { type: 'permission', decision: value.decision as 'allow' | 'allow-session' | 'deny', ...(value.message !== undefined ? { message: value.message as string } : {}) }
    case 'question': {
      const answers = value.answers
      if (!isRecord(answers) || !Object.values(answers).every(isStringArray)) return null
      return { type: 'question', answers: answers as Record<string, string[]> }
    }
    case 'plan': {
      const modes = ['ask', 'edits', 'plan', 'auto', 'full']
      if (typeof value.approve !== 'boolean' || (value.mode !== undefined && !modes.includes(value.mode as string)) || !optional(value.feedback)) return null
      return value as InteractionResponse
    }
    case 'elicitation':
      if (!['accept', 'decline', 'cancel'].includes(value.action as string) || (value.content !== undefined && !isRecord(value.content))) return null
      return value as InteractionResponse
    case 'form': {
      if (!['submit', 'decline'].includes(value.action as string)) return null
      const values = value.values
      const fine = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || isStringArray(v)
      if (values !== undefined && !(isRecord(values) && Object.values(values).every(fine))) return null
      return value as InteractionResponse
    }
    default:
      return null
  }
}

export function parseRemoteResponse(data: unknown): RemoteResponse | null {
  if (!isRecord(data) || typeof data.re !== 'string') return null
  if (isRecord(data.e)) {
    const { code, message } = data.e
    if (typeof code !== 'string' || typeof message !== 'string') return null
    return { re: data.re, e: { code: REMOTE_ERROR_CODES.has(code) ? (code as RemoteErrorCode) : 'failed', message: message.slice(0, 1000) } }
  }
  return 'r' in data ? { re: data.re, r: data.r } : null
}

/** The events of an `rc.events`, roughly checked: they come from a member, but a broken one mustn't break the window. */
export function parseRemoteEvents(data: unknown): RemoteEvent[] | null {
  if (!isRecord(data) || !Array.isArray(data.events)) return null
  const events: RemoteEvent[] = []
  for (const event of data.events) {
    if (!isRecord(event) || typeof event.ch !== 'string' || !REMOTE_EVENTS.has(event.ch)) continue
    if (Array.isArray(event.args)) {
      if (event.ch === IpcEvent.sessionEvent && !isSessionEvent(event.args[0])) continue
      if (!isFilesEvent(event.ch, event.args)) continue
      events.push({ ch: event.ch, args: event.args })
    } else if (LIST_EVENTS.has(event.ch) && isRecord(event.diff)) {
      const { ids, changed } = event.diff
      if (!isStringArray(ids) || !Array.isArray(changed) || !changed.every((e) => isRecord(e) && typeof e.id === 'string')) continue
      events.push({ ch: event.ch, diff: { ids, changed: changed as { id: string }[] } })
    }
  }
  return events
}

/** The file panel's events in the shapes it reads them (other channels pass). */
function isFilesEvent(ch: string, args: unknown[]): boolean {
  switch (ch) {
    case FilesEvent.changed:
      return typeof args[0] === 'string' && isStringArray(args[1])
    case FilesEvent.touched:
      return typeof args[0] === 'string' && Array.isArray(args[1]) && args[1].every((t) => isRecord(t) && typeof t.path === 'string' && typeof t.kind === 'string')
    case FilesEvent.gitBranchChanged:
      return typeof args[0] === 'string' && (args[1] === null || isRecord(args[1]))
    default:
      return true
  }
}

const SESSION_EVENT_TYPES = new Set(['item', 'delta', 'runtime', 'truncated'])

function isSessionEvent(event: unknown): event is SessionEvent {
  if (!isRecord(event) || !SESSION_EVENT_TYPES.has(event.type as string) || typeof event.sessionId !== 'string') return false
  switch (event.type) {
    case 'item':
      return isRecord(event.item) && typeof event.item.id === 'string' && typeof event.item.kind === 'string'
    case 'delta':
      return typeof event.itemId === 'string' && typeof event.text === 'string' && (event.field === 'text' || event.field === 'output')
    case 'runtime':
      return isRecord(event.runtime) && typeof event.runtime.status === 'string'
    default:
      return Number.isInteger(event.length)
  }
}

// --- What goes over the relay of a chat --------------------------------------------------------------

/** Longest text of one field of an item that goes to another device, in UTF-8 bytes; the rest is cut. */
export const REMOTE_TEXT_LIMIT = 64 * 1024

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * `text` cut to `limit` UTF-8 bytes, its start or (`fromEnd`) its end: by bytes, since a text of umlauts
 * or CJK takes two or three times its characters. A character cut in two goes.
 */
function cut(text: string, limit: number, fromEnd: boolean): string | null {
  // Fast ways out: no character takes more than three bytes, none less than one.
  if (text.length * 3 <= limit) return null
  const bytes = utf8.encode(text)
  if (bytes.length <= limit) return null
  const part = fromEnd ? bytes.subarray(bytes.length - limit) : bytes.subarray(0, limit)
  return utf8Decoder.decode(part).replace(/^�+|�+$/g, '')
}

function head(text: string | undefined, limit = REMOTE_TEXT_LIMIT): string | undefined {
  const start = text === undefined ? null : cut(text, limit, false)
  return start === null ? text : `${start}\n… (gekürzt)`
}

function tail(text: string | undefined, limit = REMOTE_TEXT_LIMIT): string | undefined {
  const end = text === undefined ? null : cut(text, limit, true)
  return end === null ? text : `… (gekürzt)\n${end}`
}

/** What `value` takes as JSON on the wire: UTF-8 bytes, so text with umlauts or CJK counts in full. */
export function jsonBytes(value: unknown): number {
  try {
    return value === undefined ? 0 : utf8.encode(JSON.stringify(value)).length
  } catch {
    return Infinity
  }
}

/**
 * An item as it goes to another device: texts over `limit` cut (prompts and answers at four times
 * that), what only works on the host left out. Images are paths on the host; the pages of MCP Apps
 * load from the host's MCP servers.
 */
export function slimItem(item: ChatItem, limit = REMOTE_TEXT_LIMIT): ChatItem {
  switch (item.kind) {
    case 'user':
      // The pictures as their paths there: the window fetches them with `sessions:image`.
      return { ...item, text: head(item.text, 4 * limit)! }
    case 'assistant':
    case 'thinking':
      return { ...item, text: head(item.text, 4 * limit)! }
    case 'tool': {
      // The page's own reference stays (small); its result comes with the page (`mcp-apps:page`).
      const slim = { ...item, output: tail(item.output, limit), appResult: undefined }
      if (jsonBytes(item.input) > limit) slim.input = undefined
      if (jsonBytes(item.render) > limit) slim.render = undefined
      if (item.changes) {
        slim.changes = item.changes.map((c) => ({ ...c, diff: head(c.diff, limit), oldText: head(c.oldText, limit), newText: head(c.newText, limit) }))
        // Many files changed at once: their whole texts give way first, then the changes themselves.
        if (jsonBytes(slim) > 6 * limit) slim.changes = slim.changes.map((c) => ({ ...c, oldText: undefined, newText: undefined }))
        if (jsonBytes(slim) > 6 * limit) slim.changes = undefined
      }
      return slim
    }
    case 'agent':
      return { ...item, prompt: head(item.prompt, limit), result: head(item.result, limit) }
    default:
      return item
  }
}

/** About as many UTF-8 bytes of a chat's items as go to another device at once (`remoteWindow`). */
export const REMOTE_ITEMS_BYTES = 1024 * 1024

/** Items of a chat for another device, slimmed, and how many come before them that it doesn't have yet. */
export interface RemoteItems {
  items: ChatItem[]
  older: number
}

/**
 * The items before `end` that go to another device at once, slimmed: about `budget` bytes of them. A
 * chat of thousands of items is tens of megabytes even slimmed, which would take longer over the server
 * than a request may; the newest are what the chat shows first, the ones before come as it scrolls up.
 * They begin with a prompt where one is near: the blocks of the timeline above it then don't change
 * when the items before it come (a group of tools would grow, and the window lose its place).
 */
export function remoteWindow(items: readonly ChatItem[], end: number, budget = REMOTE_ITEMS_BYTES): RemoteItems {
  // Newest first while collecting.
  const taken: ChatItem[] = []
  let bytes = 0
  let start = Math.max(0, Math.min(end, items.length))
  while (start > 0) {
    const item = slimItem(items[start - 1]!)
    const size = jsonBytes(item)
    if (taken.length && bytes + size > budget) break
    taken.push(item)
    bytes += size
    start--
  }
  if (start > 0 && taken.at(-1)?.kind !== 'user') {
    const prompt = taken.findLastIndex((item) => item.kind === 'user')
    if (prompt >= 0) {
      // The part of a turn before the prompt comes with the older ones.
      start += taken.length - 1 - prompt
      taken.length = prompt + 1
    } else {
      // One long turn: back to its prompt, but not without end.
      while (start > 0 && bytes < 4 * budget && taken.at(-1)?.kind !== 'user') {
        const item = slimItem(items[start - 1]!)
        taken.push(item)
        bytes += jsonBytes(item)
        start--
      }
    }
  }
  return { items: taken.reverse(), older: start }
}
