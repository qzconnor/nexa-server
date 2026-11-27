<script setup lang="ts">
import { ArrowDown, LoaderCircle } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, toRaw, useTemplateRef, watch } from 'vue'
import { chatAccount, chatLimits } from '../chat-limits'
import AgentDock from '../components/chat/AgentDock.vue'
import Composer from '../components/chat/Composer.vue'
import { RESPONDER } from '../components/chat/respond'
import ShellDock from '../components/chat/ShellDock.vue'
import TimelineBlocks from '../components/chat/TimelineBlocks.vue'
import UserMessage from '../components/chat/UserMessage.vue'
import { computerById, computerStatus } from '../computers'
import { duration, resumeText } from '../format'
import { host } from '../host'
import { dockShells } from '../lib/shells'
import { chatBlocks, type ChatBlock } from '../lib/tools'
import { linkState } from '../link'
import { usePageTitle } from '../page-title'
import { isUnread, type AgentItem } from '../shared/chat'
import { IpcInvoke } from '../shared/ipc'
import { PROVIDERS } from '../shared/providers'
import { levelAllows } from '../shared/remote'
import type { SessionUpdateInput } from '../shared/types'
import { pageVisible } from '../visibility'

/** One chat of a computer: its timeline, live, and below it the composer (from level `prompt`). */
const props = defineProps<{ host: string; chat: string }>()

const device = computed(() => computerById(props.host))
const status = computed(() => (device.value ? computerStatus(device.value) : null))
const level = computed(() => status.value?.level ?? null)
/** Why there is no such computer: this device isn't paired, isn't connected, or it was removed. */
const missing = computed(() => {
  if (linkState.value.status === 'unpaired') return 'Dieses Gerät ist nicht gekoppelt.'
  if (linkState.value.status !== 'online') return 'Keine Verbindung zum Server.'
  return 'Diesen Computer gibt es im Namespace nicht mehr.'
})
const meta = computed(() => host.sessions.value.find((m) => m.id === props.chat))
const chat = computed(() => host.chats.get(props.chat))
const runtime = computed(() => host.runtime(props.chat))
const running = computed(() => runtime.value.status === 'running' || runtime.value.status === 'starting')
const canPrompt = computed(() => level.value !== null && levelAllows(level.value, 'prompt'))
usePageTitle(() => (meta.value ? { text: meta.value.title, limits: chatLimits(meta.value) } : null))

// The plan limits for the header, once the computer can be asked and the chat's CLI is known.
watch(
  () => [level.value !== null, host.instance.value, meta.value?.provider] as const,
  ([usable, at, provider]) => {
    if (usable && at && provider) void host.loadLimits(provider)
  },
  { immediate: true },
)

provide(RESPONDER, {
  allowed: () => level.value !== null && levelAllows(level.value, 'full'),
  respond: async (itemId, response) => {
    await host.call(IpcInvoke.sessionsRespond, [props.chat, itemId, response])
  },
})

// Opened once the computer can be asked; again after it could not (offline, back), which costs nothing
// when the chat is still loaded.
watch(
  () => [props.host, props.chat, level.value !== null] as const,
  ([hostId, chatId, usable]) => {
    if (!usable) return
    void host.show(hostId)
    void host.open(chatId)
  },
  { immediate: true },
)
watch(
  () => props.chat,
  (_, before) => {
    if (before) host.leave(before)
  },
)
onBeforeUnmount(() => host.leave(props.chat))

// Read on screen, in front: said once per finished turn (`isUnread`), so the computer and the inbox know.
watch(
  () => {
    const m = meta.value
    return m && chat.value?.loaded && pageVisible.value && isUnread(m) ? `${m.id}:${m.finishedAt}` : null
  },
  (key) => {
    if (key) void host.call(IpcInvoke.sessionsSeen, [props.chat]).catch(() => undefined)
  },
  { immediate: true },
)

// --- The timeline ----------------------------------------------------------------------------------

/** The subagent whose work the timeline shows instead of the main thread (from the agents over the composer). */
const agentId = ref<string | null>(null)
/** The composer's „+“ menu is open: agents and shells step aside for it. */
const menuOpen = ref(false)
watch(
  () => props.chat,
  () => {
    agentId.value = null
    menuOpen.value = false
  },
)

/** Built anew when an item comes, goes or is replaced, not for every piece of streamed text (`textShown`). */
const blocks = computed<ChatBlock[]>(() => {
  const c = chat.value
  if (!c?.loaded) return []
  void c.textShown
  return chatBlocks(c.items, agentId.value, true, (item) => !!toRaw(item).text.trim())
})

/**
 * Over the composer while a subagent runs, as in the app: those of the last prompt (the finished ones
 * stay until the last is through) and background ones still at work; the one shown stays as well, so
 * the way back to the main thread does.
 */
const dockAgents = computed(() => {
  const items = chat.value?.loaded ? chat.value.items : []
  const lastPrompt = items.findLastIndex((i) => i.kind === 'user' && !i.parentId)
  const list = items.filter((i, index): i is AgentItem => i.kind === 'agent' && !i.parentId && (index > lastPrompt || i.status === 'running'))
  if (list.some((a) => a.status === 'running')) return list
  const open = agentId.value ? items.find((i): i is AgentItem => i.kind === 'agent' && i.id === agentId.value) : undefined
  return open ? [open] : []
})
/** The shells running in the background (and those since the last prompt while one does). */
const dockShellList = computed(() => (chat.value?.loaded ? dockShells(chat.value.items) : []))

/** The newest blocks only, older ones as the user scrolls up: long answers take long to lay out on a phone. */
const PAGE = 30
const anchor = ref<string | null>(null)
const keyOf = (block: ChatBlock) => (block.type === 'item' ? block.item.id : block.id)
const first = computed(() => {
  const list = blocks.value
  const at = anchor.value === null ? -1 : list.findIndex((b) => keyOf(b) === anchor.value)
  return at >= 0 ? at : Math.max(0, list.length - PAGE)
})
const shown = computed(() => (first.value ? blocks.value.slice(first.value) : blocks.value))
const more = computed(() => first.value > 0 || (chat.value?.older ?? 0) > 0)
watch(
  () => [props.chat, blocks.value.length, agentId.value] as const,
  ([id, , agent], before) => {
    if (id !== before?.[0] || agent !== before?.[2]) anchor.value = null
    if (anchor.value === null && blocks.value.length) anchor.value = keyOf(blocks.value[first.value]!)
  },
  { immediate: true },
)

const scroller = useTemplateRef<HTMLElement>('scroller')
const content = useTemplateRef<HTMLElement>('content')
const dock = useTemplateRef<HTMLElement>('dock')
const dockHeight = ref(0)
/** Following the end: new text keeps it in view until the user scrolls up. */
let stick = true
const atEnd = ref(true)
const olderError = ref<string | null>(null)
let adding = false

function toEnd(): void {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  atEnd.value = stick
  if (el.scrollTop < 600) void showOlder()
}

/** The page of blocks before the shown ones, keeping in view what the user was reading; first from the computer if needed. */
async function showOlder(): Promise<void> {
  const c = chat.value
  if (adding || !c?.loaded || !more.value) return
  adding = true
  olderError.value = null
  try {
    const el = scroller.value
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
    if (!first.value) {
      try {
        await host.loadOlder(props.chat)
      } catch (error) {
        olderError.value = error instanceof Error ? error.message : String(error)
        return
      }
      await nextTick()
      if (!first.value) return
    }
    anchor.value = keyOf(blocks.value[Math.max(0, first.value - PAGE)]!)
    await nextTick()
    if (el) el.scrollTop = el.scrollHeight - fromBottom
  } finally {
    adding = false
  }
}

let observer: ResizeObserver | null = null
onMounted(() => {
  observer = new ResizeObserver(() => {
    dockHeight.value = dock.value?.offsetHeight ?? 0
    // After the room for the dock is laid out, else the end stays beneath it.
    if (stick) void nextTick(toEnd)
  })
  if (content.value) observer.observe(content.value)
  if (dock.value) observer.observe(dock.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch(
  () => props.chat,
  () => {
    stick = true
    atEnd.value = true
  },
)

function jumpToEnd(): void {
  stick = true
  atEnd.value = true
  toEnd()
}

// --- What runs ---------------------------------------------------------------------------------------

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
// The clock runs while something does: the turn, or a shell in the background after it.
watch(
  () => running.value || dockShellList.value.some((s) => s.shell?.status === 'running'),
  (on) => {
    if (on && !ticker) ticker = setInterval(() => (now.value = Date.now()), 1000)
    if (!on && ticker) {
      clearInterval(ticker)
      ticker = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => ticker && clearInterval(ticker))

const activity = computed(() => {
  const rt = runtime.value
  if (rt.compactingSince) return 'Fasst den Kontext zusammen …'
  if (rt.status === 'starting') return 'Startet …'
  if (rt.status === 'running') return rt.turnStartedAt ? `Arbeitet seit ${duration(now.value - rt.turnStartedAt)}` : 'Arbeitet …'
  if (rt.status === 'waiting') return 'Wartet auf eine Antwort'
  return null
})
const resume = computed(() => (runtime.value.resume ? resumeText(runtime.value.resume) : null))

const placeholder = computed(() => {
  const provider = meta.value ? PROVIDERS[meta.value.provider]?.name : null
  return running.value ? 'Nachricht, während der Agent arbeitet …' : provider ? `Nachricht an ${provider} …` : 'Nachricht …'
})

const canFull = computed(() => level.value !== null && levelAllows(level.value, 'full'))
/**
 * The folder the chat's agent works in on the computer, as `cwdOf` of the app: its own (a folder in the
 * project, a worktree) or the project's. The commands of its CLI and its branch's pull request are those
 * of the folder.
 */
const cwd = computed(() => meta.value?.cwd ?? host.projects.value.find((p) => p.id === meta.value?.projectId)?.path)

async function send(text: string, images: string[]): Promise<void> {
  await host.call(IpcInvoke.sessionsSend, [props.chat, images.length ? { text, images } : { text }])
  jumpToEnd()
}

/** A picture for the prompt goes first; the computer keeps it with its own attachments and names the file. */
async function attach(data: string, mime: string): Promise<string> {
  const path = await host.call(IpcInvoke.appSaveImage, [data, mime])
  if (typeof path !== 'string') throw new Error('Der Computer hat das Bild nicht angenommen.')
  return path
}

/** Model, effort, account, permissions: the computer sends the chat's new settings back with its list. */
async function update(patch: SessionUpdateInput): Promise<void> {
  await host.call(IpcInvoke.sessionsUpdate, [props.chat, patch])
}

async function stop(): Promise<void> {
  await host.call(IpcInvoke.sessionsInterrupt, [props.chat])
}
</script>

<template>
  <div class="relative h-full">
    <div
      ref="scroller"
      class="pt-header px-safe absolute inset-0 overflow-y-auto overscroll-contain"
      :style="{ paddingBottom: `${dockHeight + 12}px` }"
      @scroll.passive="onScroll"
    >
      <!-- px-safe on the scroller: on the same element it would replace px-3. -->
      <div ref="content" class="mx-auto max-w-xl px-3 py-4">
        <!-- Until logged in the list of devices is empty: not a sign the computer is gone. -->
        <div v-if="!status && (linkState.status === 'loading' || linkState.status === 'connecting')" class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <LoaderCircle class="size-4 animate-spin" />
          Verbindet …
        </div>
        <p v-else-if="!status" class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          {{ missing }}
        </p>
        <p v-else-if="!status.level" class="rounded-lg border border-border bg-card px-3 py-3 text-sm" :class="status.tone">{{ status.text }}</p>
        <div v-else-if="chat?.error" class="space-y-3 rounded-lg border border-border bg-card px-3 py-3 text-sm">
          <p class="text-destructive">{{ chat.error }}</p>
          <button type="button" class="rounded-md border border-border px-3 py-1.5 hover:bg-accent" @click="host.open(props.chat)">
            Erneut versuchen
          </button>
        </div>
        <div v-else-if="!chat?.loaded" class="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <LoaderCircle class="size-4 animate-spin" />
          Lädt den Chat …
        </div>
        <template v-else>
          <div v-if="more" class="mb-4 flex flex-col items-center gap-1">
            <button
              type="button"
              class="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
              :disabled="chat.loadingOlder"
              @click="showOlder"
            >
              <LoaderCircle v-if="chat.loadingOlder" class="size-3.5 animate-spin" />
              Ältere Nachrichten
            </button>
            <p v-if="olderError" class="text-xs text-destructive">{{ olderError }}</p>
          </div>
          <p v-if="!blocks.length" class="py-12 text-center text-sm text-muted-foreground">Noch keine Nachrichten.</p>
          <TimelineBlocks :blocks="shown" :items="chat.items" />
          <div v-if="runtime.queued?.length" class="mt-3 space-y-2">
            <UserMessage v-for="item in runtime.queued" :key="item.id" :item="item" queued />
          </div>
          <p v-if="activity" class="mt-3 flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <LoaderCircle v-if="running" class="size-4 animate-spin text-primary" />
            {{ activity }}
          </p>
          <p v-if="runtime.status === 'error' && runtime.error" class="mt-3 px-1 text-sm break-words text-destructive">{{ runtime.error }}</p>
          <p v-if="resume" class="mt-3 px-1 text-sm text-warning">{{ resume }}</p>
        </template>
      </div>
    </div>

    <button
      v-if="!atEnd && chat?.loaded"
      type="button"
      class="glass absolute right-4 z-10 flex size-10 items-center justify-center rounded-full border border-border shadow-lg"
      :style="{ bottom: `${dockHeight + 12}px` }"
      aria-label="Zum Ende"
      @click="jumpToEnd"
    >
      <ArrowDown class="size-4" />
    </button>

    <!-- The composer floats like the dock of the other pages, as wide as it; its gap below counts as its height. -->
    <div ref="dock" class="pb-dock px-safe pointer-events-none absolute inset-x-0 bottom-0 z-10">
      <div class="pointer-events-auto mx-4 space-y-2 sm:mx-auto sm:max-w-[34rem]">
        <!--
          Agents and shells at work rest on the composer, as in the app. The „+“ menu opens over them and
          they step aside meanwhile, glass over glass would blur into one; their room stays, the chat
          doesn't jump. Each pane fades itself: faded on a wrapper, they would lose their blur until
          the end and their text would float without its glass.
        -->
        <div
          v-if="dockAgents.length || dockShellList.length"
          class="space-y-2"
          :class="menuOpen && 'pointer-events-none'"
          :inert="menuOpen"
        >
          <AgentDock
            v-if="dockAgents.length"
            v-model:shown="agentId"
            :agents="dockAgents"
            :now="now"
            class="transition-opacity duration-200"
            :class="menuOpen && 'opacity-0'"
          />
          <ShellDock
            v-if="dockShellList.length"
            :shells="dockShellList"
            :session-id="props.chat"
            :now="now"
            :full="canFull"
            class="transition-opacity duration-200"
            :class="menuOpen && 'opacity-0'"
          />
        </div>
        <Composer
          v-if="canPrompt && chat?.loaded && meta"
          v-model:menu="menuOpen"
          :draft-key="`${props.host}:${props.chat}`"
          :placeholder="placeholder"
          :running="running"
          :session-id="props.chat"
          :provider="meta.provider"
          :account="chatAccount(meta)"
          :model="meta.model"
          :effort="meta.effort"
          :mode="meta.permissionMode"
          :ultracode="meta.ultracode"
          :context="runtime.context"
          :compacting="!!runtime.compactingSince"
          :cwd="cwd"
          :full="canFull"
          :send="send"
          :stop="stop"
          :attach="attach"
          :update="update"
        />
        <p
          v-else-if="status?.level === 'read'"
          class="glass bar-round pane-edge border border-foreground/10 px-4 py-3 text-center text-xs text-muted-foreground"
        >
          Nur mitlesen. Prompts zu senden erlaubt der Computer unter Einstellungen › Geräte.
        </p>
      </div>
    </div>
  </div>
</template>
