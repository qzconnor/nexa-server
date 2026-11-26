<script setup lang="ts">
import { Bot, ChevronRight, CircleCheck, LoaderCircle, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { chatBlocks } from '../../lib/tools'
import type { AgentItem, ChatItem } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'
import TimelineBlocks from './TimelineBlocks.vue'

/** A subagent: what it was asked, its work (the items under it) and its answer, folded. */
const props = defineProps<{ item: AgentItem; items: ChatItem[] }>()

const open = ref(false)
const blocks = computed(() => (open.value ? chatBlocks(props.items, props.item.id, true) : []))
</script>

<template>
  <div class="rounded-xl border border-border bg-card text-sm">
    <button type="button" class="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left" :aria-expanded="open" @click="open = !open">
      <Bot class="mt-0.5 size-4 shrink-0 text-primary" />
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">{{ item.description || item.agentType }}</span>
        <span class="block truncate text-xs text-muted-foreground">
          {{ item.agentType }}<template v-if="item.toolCount"> · {{ item.toolCount }} Werkzeuge</template>
          <template v-if="item.status === 'running' && item.activity"> · {{ item.activity }}</template>
        </span>
      </span>
      <LoaderCircle v-if="item.status === 'running'" class="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Läuft" />
      <X v-else-if="item.status === 'error'" class="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Fehler" />
      <CircleCheck v-else-if="item.status === 'done'" class="mt-0.5 size-4 shrink-0 text-success" aria-label="Fertig" />
      <ChevronRight class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform" :class="{ 'rotate-90': open }" />
    </button>
    <div v-if="open" class="space-y-3 border-t border-border px-3 py-2.5">
      <div v-if="item.prompt">
        <p class="mb-1 text-xs font-medium text-muted-foreground">Auftrag</p>
        <p class="break-words whitespace-pre-wrap text-muted-foreground">{{ item.prompt }}</p>
      </div>
      <TimelineBlocks v-if="blocks.length" :blocks="blocks" :items="items" />
      <div v-if="item.result">
        <p class="mb-1 text-xs font-medium text-muted-foreground">Ergebnis</p>
        <MarkdownText :text="item.result" />
      </div>
    </div>
  </div>
</template>
