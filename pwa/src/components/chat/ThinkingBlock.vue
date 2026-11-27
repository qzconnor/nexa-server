<script setup lang="ts">
import { Brain, ChevronRight } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { ThinkingItem } from '../../shared/chat'
import { unfoldSettings } from '../../unfold-settings'
import MarkdownText from './MarkdownText.vue'

/**
 * Thoughts in a row, the newest as it comes: open as in the app's chat window, unless the settings
 * keep them folded (Einstellungen › Chatverlauf); a tap opens and folds them.
 */
const props = defineProps<{ items: ThinkingItem[] }>()

const latest = computed(() => props.items.at(-1)!)
/** What a tap chose; null: as the settings say. */
const toggled = ref<boolean | null>(null)
const open = computed(() => toggled.value ?? unfoldSettings.thinking)
</script>

<template>
  <div>
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground hover:bg-accent"
      :aria-expanded="open"
      @click="toggled = !open"
    >
      <Brain class="size-4 shrink-0" :class="{ 'animate-pulse': latest.streaming }" />
      <span class="min-w-0 truncate">{{ latest.streaming ? 'Denkt nach …' : 'Gedanken' }}</span>
      <ChevronRight class="ml-auto size-3.5 shrink-0 transition-transform" :class="{ 'rotate-90': open }" />
    </button>
    <div v-if="open" class="mt-1 ml-3.5 border-l border-border pl-3 text-sm text-muted-foreground">
      <MarkdownText :text="latest.text" :streaming="latest.streaming" />
    </div>
  </div>
</template>
