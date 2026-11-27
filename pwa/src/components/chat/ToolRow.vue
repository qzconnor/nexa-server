<script setup lang="ts">
import { Ban, ChevronRight, LoaderCircle, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useProjectPath } from '../../composables/useProjectPath'
import { host } from '../../host'
import { changeLines, changeStats } from '../../lib/diff'
import { browserStep, nexaToolView, TOOL_META } from '../../lib/tools'
import type { ToolItem } from '../../shared/chat'
import DiffView from './DiffView.vue'
import RenderSpecView from './RenderSpecView.vue'
import { opensByItself } from './unfold'

/**
 * One tool call: what it did in one line, its input and output when opened. Commands, changes and
 * failures come opened (unfold.ts), the rest when tapped. What it changed shows as in the app's chat
 * window: the file in the line with its counted lines, its diff with line numbers and coloured code below.
 */
const props = defineProps<{ tool: ToolItem; browser?: boolean }>()

/** Longer output shows its end only: the page of a phone isn't a terminal. */
const OUTPUT_SHOWN = 6000

const { relative, shorten } = useProjectPath()
/** What a tap chose; null: as the call is (a diff or a failure that comes later opens it). */
const toggled = ref<boolean | null>(null)
const open = computed(() => toggled.value ?? opensByItself(props.tool, host.limits.settings?.chat?.collapseDiffs === true))
const meta = computed(() => TOOL_META[props.tool.tool] ?? TOOL_META.other)
const view = computed(() => (props.browser ? browserStep(props.tool) : nexaToolView(props.tool)))
const title = computed(() => view.value?.title ?? props.tool.title)
/** Paths in the chat's folder relative to it, as in the app: on a phone the folder would fill the line. */
const detail = computed(() => {
  const text = view.value?.detail ?? props.tool.detail
  return text && !view.value ? shorten(text) : text
})
/** A command in full: its line above cuts it off. */
const command = computed(() => (props.tool.tool === 'bash' && !props.browser ? detail.value?.trim() || null : null))
const busy = computed(() => props.tool.status === 'running' || props.tool.status === 'pending')
const failed = computed(() => props.tool.status === 'error')
const hasChanges = computed(() => !!props.tool.changes?.length)

/**
 * One file changed: the line names it (its name, then its folder) and counts its lines, so its diff
 * below goes without a head that would say all that again.
 */
const single = computed(() => (props.tool.changes?.length === 1 && !view.value ? props.tool.changes[0]! : null))
const singleFile = computed(() => {
  const change = single.value
  if (!change) return null
  const shown = relative(change.path)
  const cut = Math.max(shown.lastIndexOf('/'), shown.lastIndexOf('\\'))
  const stats = changeStats(changeLines(change))
  return {
    name: shown.slice(cut + 1),
    dir: cut > 0 ? shown.slice(0, cut).replace(/\\/g, '/') : '',
    added: stats.added,
    removed: stats.removed,
    label: change.type === 'add' ? 'neu' : change.type === 'delete' ? 'gelöscht' : '',
  }
})

/** "File created successfully at …" under a diff only repeats it; what went wrong stays. */
const output = computed(() => {
  const text = props.tool.output?.trimEnd()
  if (!text || (hasChanges.value && !failed.value)) return null
  return text.length > OUTPUT_SHOWN ? `… (gekürzt)\n${text.slice(-OUTPUT_SHOWN)}` : text
})
/** The input as JSON, for tools whose one line says too little (MCP, other); not for commands and files. */
const input = computed(() => {
  if (props.tool.text) return null
  if (['bash', 'read', 'edit', 'write', 'search', 'web', 'todo'].includes(props.tool.tool) || props.tool.input === undefined) return null
  const json = JSON.stringify(props.tool.input, null, 2)
  if (!json || json === '{}') return null
  return json.length > OUTPUT_SHOWN ? `${json.slice(0, OUTPUT_SHOWN)}\n… (gekürzt)` : json
})
const openable = computed(
  () =>
    !!(output.value || input.value || command.value || props.tool.text || props.tool.changes?.length || props.tool.render || props.tool.app || props.tool.progress),
)
</script>

<template>
  <div>
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm"
      :class="openable ? 'hover:bg-accent' : 'cursor-default'"
      :aria-expanded="openable ? open : undefined"
      :disabled="!openable"
      @click="toggled = !open"
    >
      <component :is="meta.icon" class="size-4 shrink-0" :class="meta.color" />
      <!-- A changed file: its name before its folder, which shrinks first. -->
      <template v-if="singleFile">
        <span class="shrink-0 font-medium">{{ title }}</span>
        <span class="min-w-0 truncate font-mono text-xs">{{ singleFile.name }}</span>
        <span v-if="singleFile.label" class="shrink-0 rounded bg-foreground/10 px-1.5 text-[0.7rem] text-muted-foreground">{{ singleFile.label }}</span>
        <span v-if="singleFile.dir" class="min-w-0 shrink-[3] truncate font-mono text-[0.7rem] text-muted-foreground">{{ singleFile.dir }}</span>
      </template>
      <!-- Both may shrink, the detail first: a long title (an agent's description of a command) stays on the screen. -->
      <template v-else>
        <span class="min-w-0 truncate font-medium">{{ title }}</span>
        <span v-if="detail" class="min-w-0 shrink-[3] truncate font-mono text-xs text-muted-foreground">{{ detail }}</span>
      </template>
      <span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
        <span v-if="singleFile" class="mr-0.5 font-mono text-xs tabular-nums">
          <span class="text-(--syn-green)">+{{ singleFile.added }}</span>
          <span class="ml-1 text-(--syn-red)">−{{ singleFile.removed }}</span>
        </span>
        <LoaderCircle v-if="busy" class="size-3.5 animate-spin text-muted-foreground" aria-label="Läuft" />
        <X v-else-if="failed" class="size-3.5 text-destructive" aria-label="Fehler" />
        <Ban v-else-if="tool.status === 'denied'" class="size-3.5 text-destructive" aria-label="Abgelehnt" />
        <ChevronRight v-if="openable" class="size-3.5 text-muted-foreground transition-transform" :class="{ 'rotate-90': open }" />
      </span>
    </button>
    <div v-if="open && openable" class="mt-1 mb-2 ml-7 space-y-2 text-sm">
      <p v-if="tool.progress && busy" class="text-xs text-muted-foreground">{{ tool.progress }}</p>
      <pre v-if="command" class="code-block whitespace-pre-wrap break-all"><span class="text-(--syn-comment) select-none">$ </span>{{ command }}</pre>
      <p v-if="tool.text" class="break-words whitespace-pre-wrap">{{ tool.text }}</p>
      <p v-if="tool.app" class="text-xs text-muted-foreground">Die Seite dieses Werkzeugs zeigt nur der Computer.</p>
      <RenderSpecView v-if="tool.render" :spec="tool.render" />
      <DiffView v-for="change in tool.changes ?? []" :key="change.path" :change="change" :bare="!!single" />
      <pre v-if="input" class="code-block">{{ input }}</pre>
      <pre v-if="output" class="code-block" :class="{ 'text-destructive': failed }">{{ output }}</pre>
    </div>
  </div>
</template>
