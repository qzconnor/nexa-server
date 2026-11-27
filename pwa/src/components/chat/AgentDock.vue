<script setup lang="ts">
import { ArrowLeft, Bot, Check, ChevronDown, CircleStop, LoaderCircle, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { formatDuration } from '../../lib/format'
import type { AgentItem } from '../../shared/chat'

/**
 * The subagents at work, above the composer as in the app's chat (AgentDock.vue): what each one does
 * right now. A row shows that agent's work in place of the chat, „Hauptchat“ the main thread again.
 */
const props = defineProps<{ agents: AgentItem[]; now: number }>()
/** The agent whose work the chat shows; null: the main thread. */
const shown = defineModel<string | null>('shown', { required: true })
const folded = ref(false)

/** More rows would cover too much of a phone's chat; the rest on request. */
const MAX_ROWS = 3
const showAll = ref(false)

const running = computed(() => props.agents.filter((a) => a.status === 'running'))
const finished = computed(() => props.agents.length - running.value.length)
/** In the order they started; with too many, the running ones first (and the one shown). */
const rows = computed(() => {
  if (showAll.value || props.agents.length <= MAX_ROWS) return props.agents
  const first = (a: AgentItem) => a.status === 'running' || a.id === shown.value
  return [...props.agents.filter(first), ...props.agents.filter((a) => !first(a))].slice(0, MAX_ROWS)
})
const more = computed(() => props.agents.length - rows.value.length)

const elapsed = (a: AgentItem) => formatDuration(Math.max(0, (a.endedAt ?? props.now) - a.startedAt))
const state = (a: AgentItem) => (a.status === 'running' ? a.activity || 'startet …' : a.status === 'done' ? 'fertig' : a.status === 'error' ? 'fehlgeschlagen' : 'gestoppt')

function open(agent: AgentItem): void {
  shown.value = shown.value === agent.id ? null : agent.id
}
</script>

<template>
  <div class="glass card-round pane-edge flex flex-col border border-foreground/10 p-1.5">
    <div class="flex h-8 items-center gap-2 pr-0.5 pl-2 text-[0.82rem]">
      <Bot class="size-4 shrink-0 text-primary" />
      <span class="font-medium">Agents</span>
      <span class="truncate text-muted-foreground tabular-nums">
        {{ running.length }} aktiv<template v-if="finished"> · {{ finished }} fertig</template>
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          v-if="shown"
          type="button"
          class="flex h-7 items-center gap-1 rounded-lg px-2 text-[0.78rem] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          @click="shown = null"
        >
          <ArrowLeft class="size-3.5" />
          Hauptchat
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          :aria-label="folded ? 'Agents ausklappen' : 'Agents einklappen'"
          :aria-expanded="!folded"
          @click="folded = !folded"
        >
          <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': folded }" />
        </button>
      </div>
    </div>
    <div v-if="!folded" class="flex flex-col">
      <button
        v-for="a in rows"
        :key="a.id"
        type="button"
        class="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-foreground/5"
        :class="{ 'bg-primary/10 ring-1 ring-primary/25 ring-inset': shown === a.id }"
        :aria-label="`${a.description || a.agentType}: ${state(a)}`"
        :aria-current="shown === a.id ? 'page' : undefined"
        @click="open(a)"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <LoaderCircle v-if="a.status === 'running'" class="size-3.5 animate-spin text-primary" />
          <Check v-else-if="a.status === 'done'" class="size-3.5 text-success" />
          <X v-else-if="a.status === 'error'" class="size-3.5 text-destructive" />
          <CircleStop v-else class="size-3.5 text-muted-foreground" />
        </span>
        <span class="max-w-[45%] shrink-0 truncate text-[0.84rem] font-medium" :class="{ 'text-muted-foreground': a.status !== 'running' }">
          {{ a.description || a.agentType }}
        </span>
        <span class="min-w-0 flex-1 truncate text-[0.8rem] text-muted-foreground" :class="{ 'text-destructive': a.status === 'error' }">
          {{ state(a) }}
        </span>
        <span class="shrink-0 text-[0.74rem] text-muted-foreground tabular-nums">{{ elapsed(a) }}</span>
      </button>
      <button
        v-if="more || (showAll && agents.length > MAX_ROWS)"
        type="button"
        class="flex h-8 items-center rounded-lg px-2 text-left text-[0.8rem] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger zeigen' : `+ ${more} weitere` }}
      </button>
    </div>
  </div>
</template>
