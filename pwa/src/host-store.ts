import { reactive, ref, shallowReactive, shallowRef } from 'vue'
import type { ChatItem, ProviderId, SessionEvent, SessionRuntime } from './shared/chat'
import { IpcEvent, IpcInvoke } from './shared/ipc'
import { SESSIONS_OLDER, type RemoteBroadcast, type RemoteItems } from './shared/remote'
import type { RemoteWatch } from './shared/remote-ipc'
import type { Account } from './shared/accounts'
import type { AppSettings, ModelOption, Project, ProviderStatus, ProviderUsage, SessionDetail, SessionMeta } from './shared/types'

/** The part of the Remote Control client the store needs (client/remote/remote-client.ts). */
export interface HostRemote {
  invoke(instance: string, ch: string, args: unknown[]): Promise<unknown>
  setWatch(list: readonly RemoteWatch[]): void
}

/** The chat of an opened session, as the app keeps it (stores/sessions.ts). */
export interface HostChat {
  items: ChatItem[]
  index: Map<string, number>
  loaded: boolean
  /** Opening it failed: why, for the page. */
  error: string | null
  /** Items before `items` the computer didn't send yet; they come as the user scrolls up (`loadOlder`). */
  older: number
  loadingOlder: boolean
  /**
   * Counts the texts that got their first words while streaming: the timeline's blocks depend on it
   * instead of on every text, so they don't change with every piece of a streamed answer.
   */
  textShown: number
}

export const IDLE: SessionRuntime = { status: 'idle', connected: false }

/**
 * Chats kept loaded: each one's items and streamed text come over the server while it is, so the ones
 * not looked at for a while go (opened again, they load anew).
 */
export const CHATS_KEPT = 4

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The entries of a list the computer sent, those with an id: it is a member, but a broken one mustn't break the page. */
function entries<T extends { id: string }>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((e): e is T => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string') : []
}

function isDetail(value: unknown): value is SessionDetail {
  const detail = value as SessionDetail | null
  return typeof detail === 'object' && detail !== null && Array.isArray(detail.items) && typeof detail.runtime?.status === 'string'
}

/**
 * The computer the page shows: its chats, what runs there, its projects, and the chats opened here. It
 * watches that computer (`watch`), so its lists and the opened chats' items come as events; the events
 * of a chat still loading are dropped, since what came before the answer is in the answer (the computer
 * drops what waits for it when it opens one, and one channel keeps the order).
 */
export function createHostStore(remote: HostRemote) {
  const instance = ref<string | null>(null)
  const sessions = shallowRef<SessionMeta[]>([])
  const projects = shallowRef<Project[]>([])
  const runtimes = reactive(new Map<string, SessionRuntime>())
  const chats = shallowReactive(new Map<string, HostChat>())
  const list = reactive({ loaded: false, loading: false, error: null as string | null })
  /** The chat on screen. */
  const activeId = ref<string | null>(null)
  /**
   * The computer's plan limits, its accounts, the account each CLI starts with and the CLIs' models:
   * what a chat's header needs to show the limits that count for it. Asked for once a page wants them
   * (`loadLimits`), kept by the computer's events after that.
   */
  const limits = reactive({
    usage: [] as ProviderUsage[],
    accounts: [] as Account[],
    defaults: {} as Partial<Record<ProviderId, string>>,
    models: {} as Partial<Record<ProviderId, ModelOption[]>>,
    /** The computer's CLIs (installed, version) and its settings (which are switched on): the chat's CLI menu. */
    providers: [] as ProviderStatus[],
    settings: null as AppSettings | null,
    loaded: false,
  })
  let limitsAsked = false
  /** A CLI's models are asked for once per computer; missing in `limits.models` while the answer is out. */
  const modelsAsked = new Set<ProviderId>()
  /** Changes with every other computer: answers for the one before don't count any more. */
  let generation = 0

  function runtime(id: string): SessionRuntime {
    return runtimes.get(id) ?? IDLE
  }

  function watchNow(): void {
    const ids = [...chats].filter(([, chat]) => !chat.error).map(([id]) => id)
    remote.setWatch(instance.value ? [{ instance: instance.value, ids }] : [])
  }

  /** Shows `id`'s computer: watches it, and reads its lists the first time. */
  async function show(id: string): Promise<void> {
    if (instance.value !== id) {
      reset()
      instance.value = id
    }
    watchNow()
    if (!list.loaded && !list.loading) await load()
  }

  /** Nothing to show any more (unpaired, the computer removed). */
  function reset(): void {
    generation++
    instance.value = null
    sessions.value = []
    projects.value = []
    runtimes.clear()
    chats.clear()
    activeId.value = null
    Object.assign(list, { loaded: false, loading: false, error: null })
    Object.assign(limits, { usage: [], accounts: [], defaults: {}, models: {}, providers: [], settings: null, loaded: false })
    limitsAsked = false
    modelsAsked.clear()
    remote.setWatch([])
  }

  /**
   * The plan limits with what picks among them, once per computer; the models of `provider` too (a CLI
   * whose limits differ by model). Quietly nothing where the computer refuses: the header shows none.
   */
  async function loadLimits(provider: ProviderId): Promise<void> {
    const at = instance.value
    if (!at) return
    const gen = generation
    if (!modelsAsked.has(provider)) {
      modelsAsked.add(provider)
      void remote.invoke(at, IpcInvoke.providersModels, [provider]).then(
        (models) => {
          if (gen === generation) limits.models[provider] = Array.isArray(models) ? (models as ModelOption[]) : []
        },
        () => {
          if (gen === generation) limits.models[provider] = []
        },
      )
    }
    if (limitsAsked) return
    limitsAsked = true
    try {
      const [usage, accounts, settings, providers] = await Promise.all([
        remote.invoke(at, IpcInvoke.usageGet, []),
        remote.invoke(at, IpcInvoke.accountsList, []),
        remote.invoke(at, IpcInvoke.settingsGet, []),
        remote.invoke(at, IpcInvoke.providersList, []),
      ])
      if (gen !== generation) return
      limits.usage = Array.isArray(usage) ? (usage as ProviderUsage[]) : []
      limits.accounts = entries<Account>(accounts)
      setSettings(settings as AppSettings | null)
      limits.providers = Array.isArray(providers) ? (providers as ProviderStatus[]) : []
      limits.loaded = true
    } catch {
      if (gen === generation) limitsAsked = false
    }
  }

  /** The chats, what runs, the projects; again after the computer lost track of this device. */
  async function load(): Promise<void> {
    const at = instance.value
    if (!at) return
    const gen = generation
    list.loading = true
    list.error = null
    try {
      const [metas, current, projectList] = await Promise.all([
        remote.invoke(at, IpcInvoke.sessionsList, []),
        remote.invoke(at, IpcInvoke.sessionsRuntimes, []),
        remote.invoke(at, IpcInvoke.projectsList, []),
      ])
      if (gen !== generation) return
      sessions.value = entries<SessionMeta>(metas)
      projects.value = entries<Project>(projectList)
      // What ran and stopped meanwhile isn't in `current`: idle.
      runtimes.clear()
      if (typeof current === 'object' && current !== null) {
        for (const [id, state] of Object.entries(current as Record<string, SessionRuntime>)) {
          if (typeof state?.status === 'string') runtimes.set(id, state)
        }
      }
      list.loaded = true
    } catch (error) {
      if (gen === generation) list.error = errorText(error)
    } finally {
      if (gen === generation) list.loading = false
    }
  }

  function fill(chat: HostChat, detail: SessionDetail): void {
    chat.items = detail.items
    chat.index = new Map(detail.items.map((item, i) => [item.id, i]))
    chat.older = detail.older ?? 0
  }

  /** Opens a chat of the computer shown: watched first, so none of its events after the answer is missed. */
  async function open(id: string): Promise<void> {
    const at = instance.value
    if (!at) return
    activeId.value = id
    const before = chats.get(id)
    if (before && !before.error) {
      // The newest last: the ones looked at least go first (`keepFew`).
      chats.delete(id)
      chats.set(id, before)
      return
    }
    const chat = reactive<HostChat>({ items: [], index: new Map(), loaded: false, error: null, older: 0, loadingOlder: false, textShown: 0 })
    chats.delete(id)
    chats.set(id, chat)
    keepFew()
    watchNow()
    try {
      const detail = await remote.invoke(at, IpcInvoke.sessionsOpen, [id])
      if (chats.get(id) !== chat) return
      if (!isDetail(detail)) throw new Error('Der Computer hat den Chat nicht geschickt.')
      fill(chat, detail)
      runtimes.set(id, detail.runtime)
      chat.loaded = true
    } catch (error) {
      if (chats.get(id) !== chat) return
      chat.error = errorText(error)
      watchNow()
    }
  }

  /** The chat is off screen; it stays loaded for a while (`CHATS_KEPT`). */
  function leave(id: string): void {
    if (activeId.value === id) activeId.value = null
  }

  function keepFew(): void {
    for (const id of [...chats.keys()]) {
      if (chats.size <= CHATS_KEPT) return
      if (id !== activeId.value) chats.delete(id)
    }
  }

  /** The items before the first one here, about as many as came when the chat opened. */
  async function loadOlder(id: string): Promise<void> {
    const at = instance.value
    const chat = chats.get(id)
    const first = chat?.items[0]
    if (!at || !chat?.loaded || !chat.older || chat.loadingOlder || !first) return
    chat.loadingOlder = true
    try {
      const page = (await remote.invoke(at, SESSIONS_OLDER, [id, first.id])) as RemoteItems
      // Read anew meanwhile, or the first one changed: what came doesn't fit before it.
      if (chats.get(id) !== chat || chat.items[0]?.id !== first.id || !Array.isArray(page?.items)) return
      const items = [...page.items.filter((item) => !chat.index.has(item.id)), ...chat.items]
      chat.items = items
      chat.index = new Map(items.map((item, i) => [item.id, i]))
      chat.older = page.older
    } finally {
      chat.loadingOlder = false
    }
  }

  /** A call of the computer's window API for the chat shown; the computer checks the level itself. */
  async function call(ch: string, args: unknown[]): Promise<unknown> {
    const at = instance.value
    if (!at) throw new Error('Kein Computer gewählt.')
    return remote.invoke(at, ch, args)
  }

  function setSettings(settings: AppSettings | null): void {
    if (!settings) return
    limits.settings = settings
    limits.defaults = settings.defaults?.accounts ?? limits.defaults
  }

  /** The window events of the computer shown (`rc.events`), its lists whole again. */
  function onEvents(from: string, events: readonly RemoteBroadcast[]): void {
    if (from !== instance.value) return
    for (const { ch, args } of events) {
      if (ch === IpcEvent.sessionsChanged) sessions.value = entries<SessionMeta>(args[0])
      else if (ch === IpcEvent.projectsChanged) projects.value = entries<Project>(args[0])
      else if (ch === IpcEvent.sessionEvent) onSessionEvent(args[0] as SessionEvent)
      else if (ch === IpcEvent.usageChanged && Array.isArray(args[0])) limits.usage = args[0] as ProviderUsage[]
      else if (ch === IpcEvent.accountsChanged) limits.accounts = entries<Account>(args[0])
      else if (ch === IpcEvent.settingsChanged) setSettings(args[0] as AppSettings | null)
      else if (ch === IpcEvent.providersChanged && Array.isArray(args[0])) limits.providers = args[0] as ProviderStatus[]
    }
  }

  function onSessionEvent(event: SessionEvent): void {
    if (event.type === 'runtime') {
      runtimes.set(event.sessionId, event.runtime)
      return
    }
    const chat = chats.get(event.sessionId)
    if (!chat?.loaded) return
    switch (event.type) {
      case 'item': {
        const at = chat.index.get(event.item.id)
        if (at === undefined) {
          chat.index.set(event.item.id, chat.items.length)
          chat.items.push(event.item)
        } else {
          chat.items[at] = event.item
        }
        break
      }
      case 'delta': {
        const at = chat.index.get(event.itemId)
        if (at === undefined) return
        const item = chat.items[at]!
        if (event.field === 'text' && (item.kind === 'assistant' || item.kind === 'thinking')) {
          if (!item.text.trim() && event.text.trim()) chat.textShown++
          item.text += event.text
        } else if (event.field === 'output' && item.kind === 'tool') item.output = (item.output ?? '') + event.text
        break
      }
      case 'truncated': {
        // `length` counts all of the chat's items, also the older ones not here.
        const keep = event.length - chat.older
        if (keep < 0) chat.older = event.length
        for (const item of chat.items.splice(Math.max(0, keep))) chat.index.delete(item.id)
        break
      }
    }
  }

  /**
   * The computer lost track of this device (it restarted, or events got lost): the lists anew, and the
   * chat on screen; the others go and load when opened again.
   */
  async function resync(from: string): Promise<void> {
    if (from !== instance.value) return
    const gen = generation
    for (const id of [...chats.keys()]) if (id !== activeId.value) chats.delete(id)
    watchNow()
    await load()
    const id = activeId.value
    const chat = id ? chats.get(id) : undefined
    if (!id || !chat?.loaded || gen !== generation) return
    try {
      const detail = await remote.invoke(from, IpcInvoke.sessionsOpen, [id])
      if (chats.get(id) !== chat || !isDetail(detail)) return
      fill(chat, detail)
      runtimes.set(id, detail.runtime)
    } catch (error) {
      if (chats.get(id) === chat) chat.error = errorText(error)
    }
  }

  return { instance, sessions, projects, runtimes, chats, list, activeId, limits, runtime, show, reset, load, loadLimits, open, leave, loadOlder, call, onEvents, resync }
}

export type HostStore = ReturnType<typeof createHostStore>
