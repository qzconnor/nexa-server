<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { host } from '../../host'
import { formatTokens } from '../../lib/format'
import type { ContextDetail, ContextEntry, ContextPart, ContextUsage, ProviderId } from '../../shared/chat'
import { IpcInvoke } from '../../shared/ipc'
import { PROVIDERS } from '../../shared/providers'

/**
 * What fills the chat's context, by kind, as the CLI counts it (Claude Code's `/context`), as the app's
 * context ring shows it hovered (ContextCard.vue): asked for each time the pane opens, the total from the
 * runtime meanwhile.
 */
const props = defineProps<{ sessionId: string; provider: ProviderId; context: ContextUsage; busy?: boolean; compacting?: boolean }>()

const detail = ref<ContextDetail | null>(null)
const loading = ref(false)
/** The CLI told nothing (Codex, or Claude Code not running): the pane makes do with the total. */
const none = ref(false)

const used = computed(() => detail.value?.used ?? props.context.used)
const max = computed(() => detail.value?.window ?? props.context.window)
const percent = computed(() => (max.value ? (used.value / max.value) * 100 : 0))

onMounted(async () => {
  loading.value = true
  try {
    const next = (await host.call(IpcInvoke.sessionsContext, [props.sessionId])) as ContextDetail | null
    detail.value = next
    none.value = !next
  } catch {
    none.value = true
  } finally {
    loading.value = false
  }
})

/** Colours of the parts in the bar and the list, from the theme; the rest stays grey. */
const PART_COLORS: Record<string, string> = {
  system_prompt: 'bg-(--syn-yellow)',
  system_tools: 'bg-(--syn-blue)',
  mcp_tools: 'bg-(--syn-cyan)',
  mcp_instructions: 'bg-(--syn-green)',
  memory_files: 'bg-(--syn-magenta)',
  skills: 'bg-(--syn-red)',
  custom_agents: 'bg-(--tool-read)',
  messages: 'bg-primary',
}
const colorOf = (part: ContextPart) =>
  PART_COLORS[part.id] ?? (part.kind === 'free' ? 'bg-foreground/10' : part.kind === 'buffer' ? 'bg-muted-foreground/40' : 'bg-muted-foreground')

const usedParts = computed(() => (detail.value?.parts ?? []).filter((p) => p.kind === 'used' && p.tokens > 0))
const restParts = computed(() => (detail.value?.parts ?? []).filter((p) => p.kind === 'buffer' || p.kind === 'free'))
const deferredParts = computed(() => (detail.value?.parts ?? []).filter((p) => p.kind === 'deferred' && p.tokens > 0))
const buffer = computed(() => detail.value?.parts.find((p) => p.kind === 'buffer'))

const share = (tokens: number) => (max.value ? (tokens / max.value) * 100 : 0)
const formatShare = (tokens: number) => `${share(tokens).toLocaleString('de', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`
const formatCount = (n: number) => n.toLocaleString('de')

const groups = computed(() => {
  const d = detail.value
  if (!d) return []
  const list: { id: string; label: string; entries: ContextEntry[] }[] = []
  if (d.mcpServers?.length) list.push({ id: 'mcp', label: 'MCP-Server', entries: d.mcpServers })
  if (d.agents?.length) list.push({ id: 'agents', label: 'Eigene Agents', entries: d.agents })
  if (d.memoryFiles?.length) list.push({ id: 'memory', label: 'Anweisungsdateien', entries: d.memoryFiles })
  return list
})
const openGroup = ref<string | null>(null)
const fileName = (path: string) => path.split(/[\\/]/).slice(-2).join('/')
</script>

<template>
  <div class="flex min-h-0 flex-col overflow-y-auto overscroll-contain px-2.5 pt-1.5 pb-1">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-[0.95rem] font-semibold">Kontext</h2>
      <span class="text-[0.8rem] text-muted-foreground tabular-nums">{{ formatCount(used) }} / {{ formatCount(max) }}</span>
    </div>
    <div class="mt-0.5 text-[0.85rem]">{{ Math.round(percent) }} % genutzt</div>
    <p v-if="compacting" class="mt-1 text-[0.78rem] text-primary">Wird gerade zusammengefasst …</p>

    <!-- The parts side by side as they fill the window; the buffer for compacting at its end. -->
    <div class="mt-2.5 flex h-2 w-full shrink-0 overflow-hidden rounded-full bg-foreground/10">
      <template v-if="detail">
        <div v-for="part in usedParts" :key="part.id" class="h-full" :class="colorOf(part)" :style="{ width: `${share(part.tokens)}%` }" />
        <div class="flex-1" />
        <div v-if="buffer" class="h-full bg-muted-foreground/35" :style="{ width: `${share(buffer.tokens)}%` }" />
      </template>
      <div v-else class="h-full bg-primary" :style="{ width: `${Math.min(100, percent)}%` }" />
    </div>

    <div v-if="detail" class="mt-3 flex flex-col gap-1 text-[0.84rem]">
      <div v-for="part in usedParts" :key="part.id" class="flex min-w-0 items-center gap-2">
        <span class="size-2.5 shrink-0 rounded-[3px]" :class="colorOf(part)" />
        <span class="min-w-0 flex-1 truncate">{{ part.name }}</span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{{ formatCount(part.tokens) }}</span>
        <span class="w-14 shrink-0 text-right text-muted-foreground tabular-nums">{{ formatShare(part.tokens) }}</span>
      </div>
      <div class="menu-separator mx-0 my-1.5" />
      <div v-for="part in restParts" :key="part.id" class="flex min-w-0 items-center gap-2">
        <span class="size-2.5 shrink-0 rounded-[3px]" :class="colorOf(part)" />
        <span class="min-w-0 flex-1 truncate">{{ part.name }}</span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{{ formatCount(part.tokens) }}</span>
        <span class="w-14 shrink-0 text-right text-muted-foreground tabular-nums">{{ formatShare(part.tokens) }}</span>
      </div>
      <div v-for="part in deferredParts" :key="part.id" class="flex min-w-0 items-center gap-2 text-muted-foreground" title="Erst im Kontext, wenn der Agent sie sucht und lädt">
        <span class="size-2.5 shrink-0 rounded-[3px] border border-muted-foreground/50" />
        <span class="min-w-0 flex-1 truncate">{{ part.name }}</span>
        <span class="shrink-0 tabular-nums">{{ formatCount(part.tokens) }}</span>
        <span class="w-14 shrink-0 text-right">–</span>
      </div>
      <template v-if="groups.length">
        <div class="menu-separator mx-0 my-1.5" />
        <div v-for="group in groups" :key="group.id">
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-1.5 rounded-lg py-1.5 text-left hover:text-foreground"
            :aria-expanded="openGroup === group.id"
            @click="openGroup = openGroup === group.id ? null : group.id"
          >
            <ChevronRight class="size-3.5 shrink-0 transition-transform" :class="{ 'rotate-90': openGroup === group.id }" />
            <span class="min-w-0 flex-1 truncate">{{ group.label }}</span>
            <span class="shrink-0 text-muted-foreground tabular-nums">{{ group.entries.length }}</span>
          </button>
          <div v-if="openGroup === group.id" class="mb-1 ml-5 flex flex-col gap-1 text-muted-foreground">
            <div v-for="entry in group.entries" :key="entry.name" class="flex min-w-0 items-center gap-2">
              <span class="min-w-0 flex-1 truncate" :title="entry.name">{{ group.id === 'memory' ? fileName(entry.name) : entry.name }}</span>
              <span v-if="entry.count !== undefined" class="shrink-0 tabular-nums" title="Werkzeuge im Kontext / insgesamt">{{ entry.loaded ?? 0 }}/{{ entry.count }}</span>
              <span class="w-14 shrink-0 text-right tabular-nums">{{ formatTokens(entry.tokens) }}</span>
            </div>
          </div>
        </div>
      </template>
      <p v-if="detail.compactAt" class="mt-2 text-[0.76rem] text-muted-foreground">Zusammengefasst wird ab {{ formatCount(detail.compactAt) }} Tokens.</p>
    </div>
    <div v-else-if="loading" class="mt-3 flex flex-col gap-2.5" aria-label="Wird geladen">
      <div v-for="n in 5" :key="n" class="h-3 animate-pulse rounded bg-foreground/10" :style="{ width: `${90 - n * 9}%` }" />
    </div>
    <p v-else-if="none" class="mt-3 text-[0.8rem] text-muted-foreground">
      <template v-if="provider === 'claude'">Die Aufschlüsselung gibt es, solange {{ PROVIDERS.claude.name }} für diesen Chat läuft.</template>
      <template v-else>{{ PROVIDERS[provider].name }} nennt nur die Summe, keine Aufschlüsselung.</template>
    </p>
    <p v-if="busy && detail" class="mt-2 text-[0.76rem] text-muted-foreground">Stand der letzten Antwort; während der Agent arbeitet, wächst der Kontext.</p>
  </div>
</template>
