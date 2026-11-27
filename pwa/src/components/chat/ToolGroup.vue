<script setup lang="ts">
import { ChevronRight, Globe, LoaderCircle, Wrench } from '@lucide/vue'
import { computed, ref } from 'vue'
import { host } from '../../host'
import { browserStep, nexaToolView, toolSummary } from '../../lib/tools'
import type { ToolItem } from '../../shared/chat'
import { unfoldSettings } from '../../unfold-settings'
import ToolRow from './ToolRow.vue'
import { groupOpensByItself } from './unfold'

/**
 * Tool calls in a row under their summary ("2 Dateien bearbeitet · 3 Befehle"), the running one by its
 * title: open while one among them opens by itself (unfold.ts), else folded to that one line, until a
 * tap decides. `browser`: the agent's steps in Nexa's browser.
 */
const props = defineProps<{ tools: ToolItem[]; browser?: boolean }>()

/** What a tap chose; null: as the calls are (a failure that comes later opens the run). */
const toggled = ref<boolean | null>(null)
const open = computed(
  () => toggled.value ?? groupOpensByItself(props.tools, unfoldSettings, host.limits.settings?.chat?.collapseDiffs === true, props.browser),
)
const running = computed(() => props.tools.findLast((t) => t.status === 'running' || t.status === 'pending'))
const failed = computed(() => props.tools.filter((t) => t.status === 'error').length)
const summary = computed(() => {
  if (props.browser) return props.tools.length === 1 ? 'Browser · 1 Schritt' : `Browser · ${props.tools.length} Schritte`
  return toolSummary(props.tools) || 'Nexa-Werkzeuge'
})
const now = computed(() => {
  const tool = running.value
  if (!tool) return null
  return props.browser ? browserStep(tool).title : (nexaToolView(tool)?.title ?? tool.title)
})
</script>

<template>
  <ToolRow v-if="tools.length === 1" :tool="tools[0]!" :browser="browser" />
  <div v-else>
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground hover:bg-accent"
      :aria-expanded="open"
      @click="toggled = !open"
    >
      <component :is="browser ? Globe : Wrench" class="size-4 shrink-0" />
      <span class="min-w-0 truncate">{{ summary }}</span>
      <span v-if="failed" class="shrink-0 text-xs text-destructive">· {{ failed }} fehlgeschlagen</span>
      <span class="ml-auto flex shrink-0 items-center gap-1">
        <span v-if="now" class="max-w-32 truncate text-xs">{{ now }}</span>
        <LoaderCircle v-if="running" class="size-3.5 animate-spin" aria-label="Läuft" />
        <ChevronRight class="size-3.5 transition-transform" :class="{ 'rotate-90': open }" />
      </span>
    </button>
    <div v-if="open" class="ml-3 border-l border-border pl-2">
      <ToolRow v-for="tool in tools" :key="tool.id" :tool="tool" :browser="browser" />
    </div>
  </div>
</template>
