import { computed, reactive } from 'vue'
import type { InteractionResponse, SessionEvent } from './shared/chat'
import { INBOX_SECTIONS, type InboxEntry, type InboxSection } from './shared/inbox'
import { IpcEvent, IpcInvoke } from './shared/ipc'
import type { RemoteBroadcast } from './shared/remote'
import type { RemoteWatch } from './shared/remote-ipc'

/** The part of the Remote Control client the inbox needs (client/remote/remote-client.ts). */
export interface InboxRemote {
  invoke(instance: string, ch: string, args: unknown[]): Promise<unknown>
  setWatch(list: readonly RemoteWatch[]): void
}

/** What one computer's inbox holds. */
export interface ComputerInbox {
  entries: InboxEntry[]
  /** Project names by id (`projects:list`), for the entries' second line. */
  projects: Map<string, string>
  loaded: boolean
  loading: boolean
  error: string | null
}

/** An entry with the computer it is on. */
export interface InboxRow {
  instance: string
  entry: InboxEntry
  project: string | undefined
}

/**
 * How long a computer's inbox waits after a change before it asks again: a turn sends a burst of
 * runtime events and list changes, one answer is enough for all of them.
 */
export const REFRESH_MS = 400

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const SECTIONS = new Set<string>(INBOX_SECTIONS)

/** The entries a computer sent, those that look like entries: a broken member mustn't break the page. */
function parseEntries(value: unknown): InboxEntry[] {
  if (!Array.isArray(value)) throw new Error('Der Computer hat keine Inbox geschickt.')
  return value.filter((e): e is InboxEntry => typeof e?.id === 'string' && SECTIONS.has(e?.section) && typeof e?.title === 'string')
}

function projectNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>()
  if (Array.isArray(value)) for (const p of value) if (typeof p?.id === 'string' && typeof p?.name === 'string') names.set(p.id, p.name)
  return names
}

/**
 * The phone's inbox over all computers it may read (`sessions:inbox`, shared/inbox.ts): it watches each
 * of them for their list and runtime events (no chat's items) and asks again after each change.
 */
export function createInboxStore(remote: InboxRemote, delayMs = REFRESH_MS) {
  const computers = reactive(new Map<string, ComputerInbox>())
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const asking = new Set<string>()
  /** Changed while its answer was on the way: ask again once it is here. */
  const stale = new Set<string>()
  let watched = ''

  /** The computers to list: the ones online that let this device read. */
  function setComputers(ids: readonly string[]): void {
    for (const id of [...computers.keys()]) {
      if (ids.includes(id)) continue
      computers.delete(id)
      clearTimeout(timers.get(id))
      timers.delete(id)
    }
    for (const id of ids) {
      if (computers.has(id)) continue
      computers.set(id, { entries: [], projects: new Map(), loaded: false, loading: false, error: null })
      void refresh(id)
    }
    const key = [...ids].sort().join()
    if (key === watched) return
    watched = key
    remote.setWatch(ids.map((instance) => ({ instance, ids: [] })))
  }

  async function refresh(id: string): Promise<void> {
    const inbox = computers.get(id)
    if (!inbox) return
    if (asking.has(id)) {
      stale.add(id)
      return
    }
    asking.add(id)
    inbox.loading = true
    try {
      const [entries, projects] = await Promise.all([
        remote.invoke(id, IpcInvoke.sessionsInbox, []),
        inbox.loaded ? null : remote.invoke(id, IpcInvoke.projectsList, []),
      ])
      if (computers.get(id) !== inbox) return
      inbox.entries = parseEntries(entries)
      if (projects) inbox.projects = projectNames(projects)
      inbox.loaded = true
      inbox.error = null
    } catch (error) {
      if (computers.get(id) === inbox) inbox.error = errorText(error)
    } finally {
      asking.delete(id)
      if (computers.get(id) === inbox) inbox.loading = false
      if (stale.delete(id)) void refresh(id)
    }
  }

  function schedule(id: string): void {
    if (!computers.has(id)) return
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        void refresh(id)
      }, delayMs),
    )
  }

  /** A computer's window events: a change of its chats or of what runs there may change the inbox. */
  function onEvents(from: string, events: readonly RemoteBroadcast[]): void {
    const inbox = computers.get(from)
    if (!inbox) return
    for (const { ch, args } of events) {
      if (ch === IpcEvent.projectsChanged) inbox.projects = projectNames(args[0])
      else if (ch === IpcEvent.sessionsChanged || (ch === IpcEvent.sessionEvent && (args[0] as SessionEvent).type === 'runtime')) schedule(from)
    }
  }

  /** Answers a question of a chat's agent there; it goes on, and its entry moves with the next answer. */
  async function respond(id: string, sessionId: string, itemId: string, response: InteractionResponse): Promise<void> {
    await remote.invoke(id, IpcInvoke.sessionsRespond, [sessionId, itemId, response])
    const entry = computers.get(id)?.entries.find((e) => e.id === sessionId)
    if (entry?.pending) entry.pending = entry.pending.filter((item) => item.id !== itemId)
    schedule(id)
  }

  /** Each section with the entries of all computers, the newest first. */
  const sections = computed(() => {
    const rows = Object.fromEntries(INBOX_SECTIONS.map((s) => [s, [] as InboxRow[]])) as Record<InboxSection, InboxRow[]>
    for (const [instance, inbox] of computers) {
      for (const entry of inbox.entries) rows[entry.section].push({ instance, entry, project: inbox.projects.get(entry.projectId) })
    }
    for (const section of INBOX_SECTIONS) rows[section].sort((a, b) => b.entry.updatedAt - a.entry.updatedAt)
    return rows
  })

  /** What needs the user: an answer, or a look at what went wrong. */
  const attention = computed(() => sections.value.waiting.length + sections.value.trouble.length)

  return { computers, sections, attention, setComputers, refresh, onEvents, respond, resync: schedule }
}

export type InboxStore = ReturnType<typeof createInboxStore>
