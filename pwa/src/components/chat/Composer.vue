<script lang="ts">
import { reactive } from 'vue'

/** A picture for the prompt: shown from this device at once, sent to the computer meanwhile. */
interface Picture {
  id: number
  /** The picture on this device, for its thumbnail. */
  url: string
  /** Where the computer keeps it, once it has it (`app:save-image`). */
  path: string | null
}

/** What was written and attached and not sent, per chat, while the page lives: leaving a chat for a moment keeps it. */
const drafts = new Map<string, { text: string; pictures: Picture[] }>()
let nextPicture = 0

function newPicture(blob: Blob): Picture {
  return reactive({ id: nextPicture++, url: URL.createObjectURL(blob), path: null })
}
</script>

<script setup lang="ts">
import { ArrowUp, ChevronUp, GitPullRequest, GitPullRequestDraft, LoaderCircle, Plus, Square, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { host } from '../../host'
import { effortLabel, effortTone } from '../../lib/effort'
import { pullRequestState, pullRequestToneClass } from '../../lib/pull-requests'
import { usePullRequests } from '../../pull-requests'
import type { ContextUsage, PermissionMode, ProviderId } from '../../shared/chat'
import { IpcInvoke } from '../../shared/ipc'
import { PERMISSION_MODES, PROVIDERS } from '../../shared/providers'
import type { ModelDefaults, SessionUpdateInput } from '../../shared/types'
import { pageVisible } from '../../visibility'
import ProviderIcon from '../ProviderIcon.vue'
import UsageRing from '../UsageRing.vue'
import AddMenu from './AddMenu.vue'
import FloatingPane from '../FloatingPane.vue'
import ComposerSettings from './ComposerSettings.vue'
import ContextCard from './ContextCard.vue'
import { base64Of, preparePicture } from './picture'
import PullRequestsCard from './PullRequestsCard.vue'

/**
 * Writes a prompt for the chat, as the app's composer: the text above, below it the „+“ (photos,
 * commands, connectors and plugins, AddMenu.vue), the chat's CLI and model with what differs from the
 * usual (a tap: its settings, ComposerSettings.vue), the open pull requests of its repository (a tap: the
 * list, PullRequestsCard.vue), the context ring (a tap: what fills it), and the send
 * button, which stops the turn while the agent works and nothing is written. The menus come up over the
 * composer, one at a time (FloatingPane.vue). Enter sends where there is a keyboard (Shift+Enter: a new
 * line); on a phone Enter is a new line and the button sends, as in its messengers.
 */
const props = defineProps<{
  draftKey: string
  placeholder: string
  running: boolean
  disabled?: boolean
  sessionId: string
  provider: ProviderId
  /** The account the chat runs with (chat-limits.ts `chatAccount`). */
  account: string
  model: string
  effort: string
  mode: PermissionMode
  ultracode?: boolean
  /** How full the chat's context is, as its CLI last said. */
  context?: ContextUsage
  /** The CLI compacts the context right now: its ring turns meanwhile. */
  compacting?: boolean
  /** The folder the chat's agent works in on the computer. */
  cwd?: string
  /** The computer allows everything: the switches and the settings act. */
  full: boolean
  /** Changes how the chat's agent runs (`sessions:update`). */
  update: (patch: SessionUpdateInput) => Promise<void>
  send: (text: string, images: string[]) => Promise<void>
  stop: () => Promise<void>
  /** Gives a picture (base64) to the computer; the answer is where it keeps it. */
  attach: (data: string, mime: string) => Promise<string>
}>()

const draft = drafts.get(props.draftKey)
const text = ref(draft?.text ?? '')
const pictures = ref<Picture[]>(draft?.pictures ?? [])
const sending = ref(false)
const stopping = ref(false)
const error = ref<string | null>(null)
/** One of the menus over the composer is open; the page hides what rests on the composer meanwhile. */
const menuOpen = defineModel<boolean>('menu', { default: false })
const field = useTemplateRef<HTMLTextAreaElement>('field')
const photoInput = useTemplateRef<HTMLInputElement>('photoInput')
const cameraInput = useTemplateRef<HTMLInputElement>('cameraInput')
const coarse = window.matchMedia('(pointer: coarse)')

const uploading = computed(() => pictures.value.some((p) => !p.path))
const canSend = computed(() => !props.disabled && !sending.value && !uploading.value && (!!text.value.trim() || pictures.value.length > 0))

function keep(key: string): void {
  if (text.value || pictures.value.length) drafts.set(key, { text: text.value, pictures: pictures.value })
  else drafts.delete(key)
}

watch(
  () => props.draftKey,
  (key, before) => {
    if (before !== undefined) keep(before)
    const next = drafts.get(key)
    text.value = next?.text ?? ''
    pictures.value = next?.pictures ?? []
    error.value = null
  },
)
watch(text, () => {
  keep(props.draftKey)
  error.value = null
  void nextTick(fit)
})
onMounted(fit)
onBeforeUnmount(() => keep(props.draftKey))

/** Grows with its text, up to a third of the screen. */
function fit(): void {
  const el = field.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 3)}px`
}

function forget(list: Picture[]): void {
  for (const picture of list) URL.revokeObjectURL(picture.url)
}

async function submit(): Promise<void> {
  if (!canSend.value) return
  const prompt = text.value.trim()
  const sent = pictures.value
  sending.value = true
  error.value = null
  try {
    await props.send(prompt, sent.map((p) => p.path!))
    text.value = ''
    pictures.value = []
    keep(props.draftKey)
    forget(sent)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    sending.value = false
  }
}

async function interrupt(): Promise<void> {
  if (stopping.value) return
  stopping.value = true
  error.value = null
  try {
    await props.stop()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    stopping.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return
  if (event.shiftKey || (coarse.matches && !event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  void submit()
}

// --- Pictures ------------------------------------------------------------------------------------------

/** Each picture shows at once and goes to the computer meanwhile; one that can't go is taken out again. */
async function addPictures(files: readonly File[]): Promise<void> {
  const list = pictures.value
  const key = props.draftKey
  await Promise.all(
    files
      .filter((file) => file.type.startsWith('image/'))
      .map(async (file) => {
        const picture = newPicture(file)
        list.push(picture)
        if (key === props.draftKey) keep(key)
        try {
          const blob = await preparePicture(file)
          picture.path = await props.attach(await base64Of(blob), blob.type || 'image/png')
        } catch (e) {
          remove(list, picture)
          if (key === props.draftKey) error.value = `Bild nicht angehängt: ${e instanceof Error ? e.message : String(e)}`
        }
      }),
  )
}

function remove(list: Picture[], picture: Picture): void {
  const at = list.findIndex((p) => p.id === picture.id)
  if (at >= 0) list.splice(at, 1)
  forget([picture])
  // The list of another chat (left while its picture went) stays in its draft as it is.
  if (list === pictures.value) keep(props.draftKey)
}

function onPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // The same picture again is a change as well.
  input.value = ''
  if (files.length) void addPictures(files)
}

function onPaste(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  void addPictures(files)
}

// --- The menus over the composer and the chat's settings ------------------------------------------------

type Pane = 'add' | 'settings' | 'pulls' | 'context'
const pane = ref<Pane | null>(null)
watch(pane, (value) => (menuOpen.value = value !== null))
watch(menuOpen, (value) => {
  if (!value) pane.value = null
})
/** A v-model for one of the panes: opening one closes the others. */
function paneModel(which: Pane) {
  return computed({ get: () => pane.value === which, set: (open: boolean) => (pane.value = open ? which : pane.value === which ? null : pane.value) })
}
const addOpen = paneModel('add')
const settingsOpen = paneModel('settings')
const pullsOpen = paneModel('pulls')
const contextOpen = paneModel('context')
const settingsPane = useTemplateRef<InstanceType<typeof ComposerSettings>>('settingsPane')

// --- The open pull requests of the chat's repository ----------------------------------------------------

const pulls = usePullRequests({ dir: () => props.cwd, call: (ch, args) => host.call(ch, args), visible: pageVisible })
// The agent may have opened one in its turn: the computer reads anew instead of its last minute's answer.
watch(
  () => props.running,
  (now, before) => {
    if (before && !now) void pulls.refresh(true)
  },
)
const pullOwn = computed(() => pulls.own.value)
const pullOwnTone = computed(() => (pullOwn.value ? pullRequestToneClass[pullRequestState(pullOwn.value).tone] : ''))
const pullOthers = computed(() => pulls.pullRequests.value.length - (pullOwn.value ? 1 : 0))
const pullsLabel = computed(() => {
  const count = pulls.pullRequests.value.length
  const all = count === 1 ? '1 offener Pull Request' : `${count} offene Pull Requests`
  const own = pullOwn.value
  if (!own) return `${all} im Repository`
  const rest = pullOthers.value ? `, dazu ${pullOthers.value === 1 ? '1 weiterer' : `${pullOthers.value} weitere`} offen` : ''
  return `Pull Request #${own.number} dieses Branches: ${pullRequestState(own).label}${rest}`
})

const defaults = ref<ModelDefaults | null>(null)
/** Asked once the composer is used, as in the app: Claude Code answers from a short start of its own. */
const warm = ref(false)
watch(
  () => [warm.value || pane.value === 'settings', props.provider, props.account, props.model] as const,
  async ([wanted, provider, account, model]) => {
    if (!wanted) return
    try {
      const answer = (await host.call(IpcInvoke.providersModelDefaults, [provider, account, model])) as ModelDefaults | null
      if (provider === props.provider && account === props.account && model === props.model) defaults.value = answer
    } catch {
      // The chips and the slider make do with the model's own default.
    }
  },
  { immediate: true },
)

/** The chosen model by name; the CLI's when the chat follows its default. */
const modelText = computed(() => {
  if (!props.model) return PROVIDERS[props.provider].short
  return host.limits.models[props.provider]?.find((m) => m.id === props.model)?.label ?? props.model
})

/**
 * What differs from the usual stays in sight with the settings closed, as in the app; the permissions
 * first, since a narrow row drops the last ones.
 */
const chips = computed(() => {
  const list: { label: string; class: string }[] = []
  if (props.mode === 'full') list.push({ label: PERMISSION_MODES.full.label, class: 'text-destructive' })
  if (props.mode === 'plan') list.push({ label: PERMISSION_MODES.plan.label, class: 'text-primary' })
  if (props.effort && props.effort !== defaults.value?.effort) list.push({ label: effortLabel(props.effort), class: effortTone(props.effort).text })
  if (props.provider === 'claude' && defaults.value?.ultracode?.available && (props.ultracode ?? defaults.value.ultracode.on)) {
    list.push({ label: 'Ultracode', class: 'text-foreground' })
  }
  return list
})

const contextPercent = computed(() => (props.context?.window ? (props.context.used / props.context.window) * 100 : 0))

/** A command from the menu: at the start of the prompt, what was written after it. */
function insertCommand(insert: string): void {
  const rest = text.value.replace(/^\/\S*\s*/, '')
  text.value = `${insert} ${rest}`
  void nextTick(() => {
    const el = field.value
    if (!el) return
    el.focus()
    el.setSelectionRange(insert.length + 1, insert.length + 1)
  })
}
</script>

<template>
  <!-- relative: the „+“ menu opens above it, as wide as it. -->
  <form class="relative" @submit.prevent="submit">
    <!-- The shadow on a wrapper: the pane's clip (bar-round) would cut it off. -->
    <div class="floating">
      <div class="glass bar-round pane-edge border border-foreground/10 transition-colors focus-within:border-ring/60">
        <p v-if="error" class="px-4 pt-3 text-xs text-destructive" role="alert">{{ error }}</p>
        <div v-if="pictures.length" class="flex gap-2 overflow-x-auto px-3 pt-3">
          <div v-for="picture in pictures" :key="picture.id" class="relative shrink-0 p-1.5">
            <img :src="picture.url" alt="" class="size-16 rounded-xl border border-foreground/10 object-cover" :class="{ 'opacity-50': !picture.path }" />
            <LoaderCircle v-if="!picture.path" class="absolute inset-0 m-auto size-5 animate-spin" aria-label="Wird angehängt" />
            <button
              type="button"
              class="absolute top-0 right-0 flex size-6 items-center justify-center rounded-full border border-foreground/10 bg-popover text-foreground"
              aria-label="Bild entfernen"
              @click="remove(pictures, picture)"
            >
              <X class="size-3.5" />
            </button>
          </div>
        </div>
        <textarea
          ref="field"
          v-model="text"
          rows="1"
          class="block max-h-[33vh] min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1.5 text-base leading-relaxed outline-none placeholder:text-muted-foreground/70"
          :placeholder="placeholder"
          :disabled="disabled"
          aria-label="Prompt"
          @keydown="onKeydown"
          @paste="onPaste"
          @focus="warm = true"
        />
        <!-- A container: what fits beside the buttons depends on the composer's width, not the window's. -->
        <div class="@container flex min-w-0 items-center gap-1 px-2 pb-2">
          <button
            type="button"
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            :class="{ 'bg-foreground/10 text-foreground': addOpen }"
            :disabled="disabled"
            aria-label="Hinzufügen"
            aria-haspopup="dialog"
            :aria-expanded="addOpen"
            @click="addOpen = true"
          >
            <Plus class="size-5" />
          </button>
          <!-- The chat's CLI and model, and what differs from the usual: everything shrinks before it leaves the row. -->
          <button
            type="button"
            class="flex h-9 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-sm transition-colors hover:bg-foreground/5"
            :class="{ 'bg-foreground/10': settingsOpen }"
            aria-label="Modell, Denkaufwand und Freigaben"
            aria-haspopup="dialog"
            :aria-expanded="settingsOpen"
            @click="settingsOpen = true"
          >
            <ProviderIcon :provider="provider" />
            <span class="min-w-[2.5rem] truncate">{{ modelText }}</span>
            <!-- Chips that don't fit drop out whole instead of turning into „Maxi…“: they wrap into a line that is cut off. -->
            <span v-if="chips.length" class="flex h-5 min-w-0 shrink-[10] flex-wrap items-center gap-x-1.5 overflow-hidden text-[0.8rem] leading-5">
              <span v-for="chip in chips" :key="chip.label" class="max-w-full truncate" :class="chip.class">{{ chip.label }}</span>
            </span>
            <ChevronUp class="size-3.5 shrink-0 opacity-60 transition-transform" :class="{ 'rotate-180': settingsOpen }" />
          </button>
          <!--
            The open pull requests, as in the app: the branch's by its number, coloured by how it stands, else
            how many are open. Narrow, only the icon and the number stay.
          -->
          <button
            v-if="pulls.pullRequests.value.length"
            type="button"
            class="flex h-9 shrink-0 items-center gap-1 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5"
            :class="{ 'bg-foreground/10': pullsOpen }"
            :aria-label="pullsLabel"
            :title="pullsLabel"
            aria-haspopup="dialog"
            :aria-expanded="pullsOpen"
            @click="pullsOpen = true"
          >
            <template v-if="pullOwn">
              <component :is="pullOwn.draft ? GitPullRequestDraft : GitPullRequest" class="size-4 shrink-0" :class="pullOwnTone" />
              <span class="text-foreground tabular-nums">#{{ pullOwn.number }}</span>
              <span v-if="pullOthers" class="hidden text-xs tabular-nums @xs:inline">+{{ pullOthers }}</span>
            </template>
            <template v-else>
              <GitPullRequest class="size-4 shrink-0" />
              <span class="text-foreground tabular-nums">{{ pulls.pullRequests.value.length }}</span>
              <span class="hidden @sm:inline">offen</span>
            </template>
          </button>
          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              v-if="context?.window"
              type="button"
              class="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-foreground/5"
              :class="{ 'bg-foreground/10': contextOpen }"
              :aria-label="compacting ? 'Kontext wird zusammengefasst' : `Kontext: ${Math.round(contextPercent)} % genutzt`"
              aria-haspopup="dialog"
              :aria-expanded="contextOpen"
              @click="contextOpen = true"
            >
              <UsageRing :percent="contextPercent" :size="18" :spinning="compacting" />
            </button>
            <button
              v-if="running && !text.trim() && !pictures.length"
              type="button"
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground transition-colors hover:bg-foreground/15 disabled:opacity-50"
              :disabled="stopping"
              aria-label="Anhalten"
              title="Anhalten"
              @click="interrupt"
            >
              <LoaderCircle v-if="stopping" class="size-4 animate-spin" />
              <Square v-else class="size-3.5 fill-current" />
            </button>
            <!-- Also while the agent works: the prompt waits in the chat until the agent takes it up. -->
            <button
              v-else
              type="submit"
              class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              :disabled="!canSend"
              aria-label="Senden"
              title="Senden"
            >
              <LoaderCircle v-if="sending" class="size-4 animate-spin" />
              <ArrowUp v-else class="size-4" :stroke-width="2.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <input ref="photoInput" type="file" accept="image/*" multiple class="hidden" @change="onPicked" />
    <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onPicked" />
    <AddMenu
      v-model:open="addOpen"
      :session-id="sessionId"
      :provider="provider"
      :account="account"
      :cwd="cwd"
      :full="full"
      @photos="photoInput?.click()"
      @camera="cameraInput?.click()"
      @command="insertCommand"
    />
    <FloatingPane v-model:open="settingsOpen" label="Modell, Denkaufwand und Freigaben" :back="() => settingsPane?.back() ?? false">
      <ComposerSettings
        ref="settingsPane"
        :provider="provider"
        :account="account"
        :model="model"
        :effort="effort"
        :mode="mode"
        :ultracode="ultracode"
        :defaults="defaults"
        :full="full"
        :update="update"
      />
    </FloatingPane>
    <FloatingPane v-if="pulls.pullRequests.value.length" v-model:open="pullsOpen" label="Offene Pull Requests">
      <PullRequestsCard
        :pull-requests="pulls.pullRequests.value"
        :branch="pulls.branch.value"
        :web-url="pulls.webUrl.value"
        :loading="pulls.loading.value"
        @refresh="pulls.refresh(true)"
        @done="pullsOpen = false"
      />
    </FloatingPane>
    <FloatingPane v-if="context?.window" v-model:open="contextOpen" label="Kontext">
      <ContextCard :session-id="sessionId" :provider="provider" :context="context" :busy="running" :compacting="compacting" />
    </FloatingPane>
  </form>
</template>
