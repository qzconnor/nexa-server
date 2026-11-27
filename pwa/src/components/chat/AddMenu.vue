<script setup lang="ts">
import { Blocks, Camera, ChevronLeft, ChevronRight, LoaderCircle, Paperclip, Puzzle, Search, SquareSlash } from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'
import { host } from '../../host'
import type { ProviderId } from '../../shared/chat'
import { IpcInvoke } from '../../shared/ipc'
import { PROVIDERS } from '../../shared/providers'
import type { CommandOption, McpServerInfo, PluginInfo } from '../../shared/types'
import FloatingPane from '../FloatingPane.vue'

/**
 * The composer's „+“, as in the app (ComposerAddMenu.vue): photos, the CLI's commands, and the chat's
 * connectors and plugins, in a pane over the composer (FloatingPane.vue). Connectors, plugins
 * and commands open in it in place of the list, as the app's submenus would, which a phone has no room
 * for beside it. Their switches act on the computer, which allows that only at the level „full“.
 */
const props = defineProps<{
  sessionId: string
  provider: ProviderId
  /** The chat's account for its CLI, for the commands it knows. */
  account?: string
  /** The chat's folder on the computer, for its commands. */
  cwd?: string
  /** The computer lets this device switch connectors and plugins. */
  full: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ photos: []; camera: []; command: [insert: string] }>()

type Page = 'main' | 'commands' | 'connectors' | 'plugins'
const page = ref<Page>('main')
const query = ref('')
const TITLES: Record<Exclude<Page, 'main'>, string> = { commands: 'Slash-Befehle', connectors: 'Konnektoren', plugins: 'Plugins' }

/** A camera of its own where there is one to hold: a phone. */
const coarse = window.matchMedia('(pointer: coarse)').matches

watch(open, (value) => {
  if (!value) return
  page.value = 'main'
  query.value = ''
})

function go(next: Page): void {
  page.value = next
  query.value = ''
  if (next === 'commands') void commands.load()
  if (next === 'connectors') void servers.load()
  if (next === 'plugins') void plugins.load()
}

function close(): void {
  open.value = false
}

function pick(what: 'photos' | 'camera'): void {
  // The file dialog opens from the tap itself (a browser wants a gesture), the menu goes meanwhile.
  if (what === 'camera') emit('camera')
  else emit('photos')
  close()
}

/** Esc on a page goes back to the list. */
function back(): boolean {
  if (page.value === 'main') return false
  page.value = 'main'
  return true
}

// --- Lists from the computer -------------------------------------------------------------------------

/** A list the computer gives on request, asked for as its page opens, kept until the chat changes. */
function remoteList<T>(ask: () => Promise<unknown>) {
  const items = shallowRef<T[] | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      const answer = await ask()
      items.value = Array.isArray(answer) ? (answer as T[]) : []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }
  return { items, loading, error, load }
}

const commands = remoteList<CommandOption>(() => host.call(IpcInvoke.providersCommands, [props.provider, props.account, props.cwd]))
const servers = remoteList<McpServerInfo>(() => host.call(IpcInvoke.sessionsMcpServers, [props.sessionId]))
const plugins = remoteList<PluginInfo>(() => host.call(IpcInvoke.sessionsPlugins, [props.sessionId]))

watch(
  () => [props.sessionId, props.provider],
  () => {
    for (const list of [commands, servers, plugins]) list.items.value = null
  },
)

/** Every word searched for in what the row shows. */
function matches(text: string): boolean {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = text.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

const shownCommands = computed(() => (commands.items.value ?? []).filter((c) => matches(`${c.insert} ${c.description ?? ''}`)))

function insert(command: CommandOption): void {
  emit('command', command.insert)
  close()
}

// --- Connectors and plugins ----------------------------------------------------------------------------

/** Never signed in: of the claude.ai connectors usually most, and nothing the chat can use. Folded, as in the app. */
const showUnused = ref(false)
const isUnused = (server: McpServerInfo) => server.status === 'needs-auth'
const shownServers = computed(() => {
  const list = (servers.items.value ?? []).filter((s) => matches(`${label(s)} ${s.scope ?? ''}`))
  if (query.value.trim()) return { used: list, unused: [] as McpServerInfo[] }
  return { used: list.filter((s) => !isUnused(s)), unused: list.filter(isUnused) }
})
const serverRows = computed(() => [...shownServers.value.used, ...(showUnused.value ? shownServers.value.unused : [])])

/** A claude.ai connector by its name without the prefix all of them share; a plugin's server by the server's. */
function label(server: McpServerInfo): string {
  if (server.scope === 'claudeai') return server.name.replace(/^claude\.ai\s+/, '')
  const plugin = /^plugin:([^:]+):(.+)$/.exec(server.name)
  if (plugin) return plugin[1] === plugin[2] ? plugin[2]! : `${plugin[2]} (${plugin[1]})`
  return server.name
}

const STATUS: Record<McpServerInfo['status'], { dot: string; text: string }> = {
  connected: { dot: 'bg-success', text: 'Verbunden' },
  pending: { dot: 'bg-muted-foreground animate-pulse', text: 'Verbindet …' },
  failed: { dot: 'bg-destructive', text: 'Fehlgeschlagen' },
  'needs-auth': { dot: 'bg-warning', text: 'Anmeldung nötig' },
  disabled: { dot: 'bg-muted-foreground/40', text: 'Aus' },
  configured: { dot: 'bg-success/50', text: 'Eingerichtet' },
}

function serverText(server: McpServerInfo): string {
  if (!server.enabled) return 'Aus in diesem Projekt'
  const parts = [STATUS[server.status].text]
  if (server.tools) parts.push(`${server.tools} Werkzeuge`)
  if (server.error) parts.push(server.error)
  return parts.join(' · ')
}

/** Switched at once in the list, back if the computer refuses. */
const switchError = ref<string | null>(null)

async function toggleServer(server: McpServerInfo): Promise<void> {
  if (!props.full) return
  const enabled = !server.enabled
  const set = (value: boolean) => (servers.items.value = (servers.items.value ?? []).map((s) => (s.name === server.name ? { ...s, enabled: value } : s)))
  set(enabled)
  switchError.value = null
  try {
    await host.call(IpcInvoke.sessionsSetMcp, [props.sessionId, server.name, enabled])
  } catch (e) {
    set(!enabled)
    switchError.value = e instanceof Error ? e.message : String(e)
  }
}

async function togglePlugin(plugin: PluginInfo): Promise<void> {
  if (!props.full || plugin.locked) return
  const enabled = !plugin.enabled
  const set = (value: boolean) => (plugins.items.value = (plugins.items.value ?? []).map((p) => (p.id === plugin.id ? { ...p, enabled: value } : p)))
  set(enabled)
  switchError.value = null
  try {
    await host.call(IpcInvoke.sessionsSetPlugin, [props.sessionId, plugin.id, enabled])
  } catch (e) {
    set(!enabled)
    switchError.value = e instanceof Error ? e.message : String(e)
  }
}

const shownPlugins = computed(() => (plugins.items.value ?? []).filter((p) => matches(`${p.name} ${p.description ?? ''}`)))
watch(page, () => (switchError.value = null))
</script>

<template>
  <FloatingPane v-model:open="open" :label="page === 'main' ? 'Hinzufügen' : TITLES[page]" :back="back">
    <!-- What is added to the prompt, and what the chat's agent can reach. -->
    <div v-if="page === 'main'" class="flex flex-col">
      <button type="button" class="menu-row" @click="pick('photos')">
        <Paperclip class="menu-icon" />
        <span class="flex-1">Fotos hinzufügen</span>
      </button>
      <button v-if="coarse" type="button" class="menu-row" @click="pick('camera')">
        <Camera class="menu-icon" />
        <span class="flex-1">Foto aufnehmen</span>
      </button>
      <button type="button" class="menu-row" @click="go('commands')">
        <SquareSlash class="menu-icon" />
        <span class="flex-1">Slash-Befehle</span>
        <ChevronRight class="menu-icon" />
      </button>
      <div class="menu-separator" />
      <button type="button" class="menu-row" @click="go('connectors')">
        <Blocks class="menu-icon" />
        <span class="flex-1">Konnektoren</span>
        <ChevronRight class="menu-icon" />
      </button>
      <button type="button" class="menu-row" @click="go('plugins')">
        <Puzzle class="menu-icon" />
        <span class="flex-1">Plugins</span>
        <ChevronRight class="menu-icon" />
      </button>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center gap-1 pr-1">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          aria-label="Zurück"
          @click="page = 'main'"
        >
          <ChevronLeft class="size-5" />
        </button>
        <h2 class="flex-1 text-[0.95rem] font-semibold">{{ TITLES[page] }}</h2>
      </div>
      <label class="mx-1 mt-1 mb-1.5 flex shrink-0 items-center gap-2 rounded-xl border border-foreground/10 bg-foreground/5 px-3 focus-within:border-ring/60">
        <Search class="size-4 shrink-0 text-muted-foreground" />
        <input
          v-model="query"
          type="search"
          class="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          :placeholder="`${TITLES[page]} durchsuchen`"
          :aria-label="`${TITLES[page]} durchsuchen`"
        />
      </label>
      <div class="menu-separator" />

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <!-- The CLI's commands: a tap writes one into the prompt. -->
        <template v-if="page === 'commands'">
          <p v-if="commands.loading.value && !commands.items.value" class="menu-note"><LoaderCircle class="size-4 animate-spin" /> Wird geladen …</p>
          <p v-else-if="commands.error.value" class="menu-note text-destructive">{{ commands.error.value }}</p>
          <p v-else-if="commands.items.value && !shownCommands.length" class="menu-note">
            {{ query ? 'Kein Treffer.' : `${PROVIDERS[provider].name} nennt keine Befehle.` }}
          </p>
          <button v-for="command in shownCommands" :key="command.insert" type="button" class="menu-row h-auto items-start py-2" @click="insert(command)">
            <SquareSlash class="menu-icon mt-0.5" />
            <span class="min-w-0 flex-1">
              <span class="block truncate">
                <span class="font-mono text-[0.88rem]">{{ command.insert }}</span>
                <span v-if="command.argumentHint" class="ml-1.5 text-[0.8rem] text-muted-foreground">{{ command.argumentHint }}</span>
              </span>
              <span v-if="command.description" class="line-clamp-2 text-[0.8rem] text-muted-foreground">{{ command.description }}</span>
            </span>
          </button>
        </template>

        <!-- The chat's MCP servers, on and off for its project. -->
        <template v-else-if="page === 'connectors'">
          <p v-if="servers.loading.value && !servers.items.value" class="menu-note"><LoaderCircle class="size-4 animate-spin" /> Wird geladen …</p>
          <p v-else-if="servers.error.value" class="menu-note text-destructive">{{ servers.error.value }}</p>
          <p v-else-if="servers.items.value && !servers.items.value.length" class="menu-note">{{ PROVIDERS[provider].name }} hat keine MCP-Server eingerichtet.</p>
          <p v-else-if="servers.items.value && !shownServers.used.length && !shownServers.unused.length" class="menu-note">Kein Treffer.</p>
          <button
            v-for="server in serverRows"
            :key="server.name"
            type="button"
            role="switch"
            :aria-checked="server.enabled"
            :aria-disabled="!full"
            class="menu-row h-auto py-2"
            @click="toggleServer(server)"
          >
            <span class="mx-1 size-2 shrink-0 rounded-full" :class="server.enabled ? STATUS[server.status].dot : 'bg-muted-foreground/30'" />
            <span class="min-w-0 flex-1">
              <span class="block truncate" :class="{ 'text-muted-foreground': !server.enabled }">{{ label(server) }}</span>
              <span class="block truncate text-[0.76rem] text-muted-foreground">{{ serverText(server) }}</span>
            </span>
            <span class="menu-switch" :class="[server.enabled ? 'bg-primary' : 'bg-foreground/20', { 'opacity-50': !full }]">
              <span :class="server.enabled ? 'translate-x-4' : 'translate-x-0'" />
            </span>
          </button>
          <button v-if="shownServers.unused.length" type="button" class="menu-row text-muted-foreground" :aria-expanded="showUnused" @click="showUnused = !showUnused">
            <ChevronRight class="menu-icon transition-transform" :class="{ 'rotate-90': showUnused }" />
            <span class="flex-1">{{ showUnused ? 'Ungenutzte Konnektoren ausblenden' : 'Ungenutzte Konnektoren zeigen' }}</span>
            <span class="text-[0.8rem] tabular-nums">{{ shownServers.unused.length }}</span>
          </button>
        </template>

        <!-- The CLI's plugins, on and off for its account. -->
        <template v-else-if="page === 'plugins'">
          <p v-if="plugins.loading.value && !plugins.items.value" class="menu-note"><LoaderCircle class="size-4 animate-spin" /> Wird geladen …</p>
          <p v-else-if="plugins.error.value" class="menu-note text-destructive">{{ plugins.error.value }}</p>
          <p v-else-if="plugins.items.value && !shownPlugins.length" class="menu-note">
            {{ query ? 'Kein Treffer.' : `${PROVIDERS[provider].name} hat für diesen Ordner keine Plugins installiert.` }}
          </p>
          <button
            v-for="plugin in shownPlugins"
            :key="plugin.id"
            type="button"
            role="switch"
            :aria-checked="plugin.enabled"
            :aria-disabled="!full || !!plugin.locked"
            :title="plugin.locked"
            class="menu-row h-auto py-2"
            @click="togglePlugin(plugin)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate" :class="{ 'text-muted-foreground': !plugin.enabled }">{{ plugin.name }}</span>
              <span v-if="plugin.description || plugin.locked" class="line-clamp-2 text-[0.76rem] text-muted-foreground">{{ plugin.locked ?? plugin.description }}</span>
            </span>
            <span class="menu-switch" :class="[plugin.enabled ? 'bg-primary' : 'bg-foreground/20', { 'opacity-50': !full || plugin.locked }]">
              <span :class="plugin.enabled ? 'translate-x-4' : 'translate-x-0'" />
            </span>
          </button>
        </template>
      </div>

      <template v-if="page !== 'commands'">
        <div class="menu-separator" />
        <p v-if="switchError" class="px-2.5 pb-1 text-[0.76rem] text-destructive" role="alert">{{ switchError }}</p>
        <p class="px-2.5 pt-0.5 pb-1 text-[0.72rem] leading-snug text-muted-foreground">
          <template v-if="page === 'connectors'">Schalter gelten für alle Chats des Projekts.</template>
          <template v-else>Gilt für {{ PROVIDERS[provider].name }} mit diesem Account, auch außerhalb von Nexa.</template>
          <template v-if="!full"> Umschalten erlaubt der Computer erst mit der Freigabe „Alles“.</template>
        </p>
      </template>
    </template>
  </FloatingPane>
</template>
