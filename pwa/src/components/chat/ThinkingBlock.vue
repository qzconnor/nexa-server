<script setup lang="ts">
import { Brain } from '@lucide/vue'
import { computed } from 'vue'
import type { ThinkingItem } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'

/** Thoughts in a row, always open as in the app's chat window: the newest, as it comes. */
const props = defineProps<{ items: ThinkingItem[] }>()

const latest = computed(() => props.items.at(-1)!)
</script>

<template>
  <div>
    <div class="flex items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground">
      <Brain class="size-4" :class="{ 'animate-pulse': latest.streaming }" />
      {{ latest.streaming ? 'Denkt nach …' : 'Gedanken' }}
    </div>
    <div class="mt-1 ml-3.5 border-l border-border pl-3 text-sm text-muted-foreground">
      <MarkdownText :text="latest.text" :streaming="latest.streaming" />
    </div>
  </div>
</template>
