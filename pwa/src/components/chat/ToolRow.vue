<script setup lang="ts">
import { Ban, ChevronRight, LoaderCircle, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { browserStep, nexaToolView, TOOL_META } from '../../lib/tools'
import type { FileChange, ToolItem } from '../../shared/chat'
import RenderSpecView from './RenderSpecView.vue'

/** One tool call: what it did in one line, its input and output when opened. */
const props = defineProps<{ tool: ToolItem; browser?: boolean }>()

/** Longer output shows its end only: the page of a phone isn't a terminal. */
const OUTPUT_SHOWN = 6000

const open = ref(false)
const meta = computed(() => TOOL_META[props.tool.tool] ?? TOOL_META.other)
const view = computed(() => (props.browser ? browserStep(props.tool) : nexaToolView(props.tool)))
const title = computed(() => view.value?.title ?? props.tool.title)
const detail = computed(() => view.value?.detail ?? props.tool.detail)
const busy = computed(() => props.tool.status === 'running' || props.tool.status === 'pending')

const output = computed(() => {
  const text = props.tool.output?.trimEnd()
  if (!text) return null
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
  () => !!(output.value || input.value || props.tool.text || props.tool.changes?.length || props.tool.render || props.tool.app || props.tool.progress),
)

/** Lines of a change, coloured: its diff (Codex), else the replaced and the new text (Claude's Edit, Write). */
function changeLines(change: FileChange): { text: string; tone: string }[] {
  const MAX = 400
  if (change.diff) {
    return change.diff
      .split('\n')
      .slice(0, MAX)
      .map((text) => ({
        text,
        tone: text.startsWith('+') && !text.startsWith('+++') ? 'text-success' : text.startsWith('-') && !text.startsWith('---') ? 'text-destructive' : '',
      }))
  }
  const removed = change.oldText ? change.oldText.split('\n').map((line) => ({ text: `- ${line}`, tone: 'text-destructive' })) : []
  const added = change.newText ? change.newText.split('\n').map((line) => ({ text: `+ ${line}`, tone: 'text-success' })) : []
  return [...removed, ...added].slice(0, MAX)
}

const CHANGE_LABEL = { add: 'neu', update: 'geändert', delete: 'gelöscht' } as const
</script>

<template>
  <div>
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm"
      :class="openable ? 'hover:bg-accent' : 'cursor-default'"
      :aria-expanded="openable ? open : undefined"
      :disabled="!openable"
      @click="open = !open"
    >
      <component :is="meta.icon" class="size-4 shrink-0" :class="meta.color" />
      <span class="shrink-0 font-medium">{{ title }}</span>
      <span v-if="detail" class="min-w-0 truncate font-mono text-xs text-muted-foreground">{{ detail }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1">
        <LoaderCircle v-if="busy" class="size-3.5 animate-spin text-muted-foreground" aria-label="Läuft" />
        <X v-else-if="tool.status === 'error'" class="size-3.5 text-destructive" aria-label="Fehler" />
        <Ban v-else-if="tool.status === 'denied'" class="size-3.5 text-destructive" aria-label="Abgelehnt" />
        <ChevronRight v-if="openable" class="size-3.5 text-muted-foreground transition-transform" :class="{ 'rotate-90': open }" />
      </span>
    </button>
    <div v-if="open" class="mt-1 mb-2 ml-7 space-y-2 text-sm">
      <p v-if="tool.progress && busy" class="text-xs text-muted-foreground">{{ tool.progress }}</p>
      <p v-if="tool.text" class="break-words whitespace-pre-wrap">{{ tool.text }}</p>
      <p v-if="tool.app" class="text-xs text-muted-foreground">Die Seite dieses Werkzeugs zeigt nur der Computer.</p>
      <RenderSpecView v-if="tool.render" :spec="tool.render" />
      <div v-for="change in tool.changes ?? []" :key="change.path" class="space-y-1">
        <p class="font-mono text-xs break-all">
          {{ change.movePath ? `${change.path} → ${change.movePath}` : change.path }}
          <span class="text-muted-foreground">({{ CHANGE_LABEL[change.type] }})</span>
        </p>
        <pre v-if="change.diff || change.oldText || change.newText" class="code-block"><span v-for="(line, i) in changeLines(change)" :key="i" class="block" :class="line.tone">{{ line.text || ' ' }}</span></pre>
      </div>
      <pre v-if="input" class="code-block">{{ input }}</pre>
      <pre v-if="output" class="code-block" :class="{ 'text-destructive': tool.status === 'error' }">{{ output }}</pre>
    </div>
  </div>
</template>
