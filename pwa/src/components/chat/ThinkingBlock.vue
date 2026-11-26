<script setup lang="ts">
import { Brain, ChevronRight } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { ThinkingItem } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'

/** Thoughts in a row: folded, the newest when opened. */
const props = defineProps<{ items: ThinkingItem[] }>()

const open = ref(false)
const latest = computed(() => props.items.at(-1)!)
</script>

<template>
  <div>
    <button
      type="button"
      class="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Brain class="size-4" :class="{ 'animate-pulse': latest.streaming }" />
      {{ latest.streaming ? 'Denkt nach …' : 'Gedanken' }}
      <ChevronRight class="size-3.5 transition-transform" :class="{ 'rotate-90': open }" />
    </button>
    <div v-if="open" class="mt-1 ml-7 border-l border-border pl-3 text-sm text-muted-foreground">
      <MarkdownText :text="latest.text" :streaming="latest.streaming" />
    </div>
  </div>
</template>
