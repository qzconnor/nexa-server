<script setup lang="ts">
import type { ProviderId } from '../shared/chat'

/**
 * A neutral mark per CLI, the same as the app's (components/common/ProviderIcon.vue): a spark for Claude
 * Code, a hexagon for Codex, an arch lifting off for Antigravity CLI.
 */
defineProps<{ provider: ProviderId }>()
</script>

<template>
  <svg v-if="provider === 'claude'" viewBox="0 0 16 16" aria-hidden="true" class="size-4 text-(--provider-claude)">
    <path
      fill="currentColor"
      d="M8 1.2c.35 0 .6.27.62.62l.2 3.9 2.6-2.9a.62.62 0 0 1 .95.8l-2.32 3.15 3.9-.2a.62.62 0 0 1 .1 1.24l-3.86.55 3.02 2.47a.62.62 0 0 1-.78.97L9.3 9.5l.55 3.86a.62.62 0 0 1-1.24.1L8 9.6l-.6 3.86a.62.62 0 0 1-1.24-.1l.55-3.86-3.13 2.31a.62.62 0 0 1-.78-.97L5.82 8.4l-3.86-.55a.62.62 0 0 1 .1-1.24l3.9.2-2.32-3.15a.62.62 0 0 1 .95-.8l2.6 2.9.2-3.9c.02-.35.27-.62.61-.62Z"
    />
  </svg>
  <svg v-else-if="provider === 'antigravity'" viewBox="0 0 16 16" aria-hidden="true" class="size-4 text-(--provider-antigravity)">
    <path fill="currentColor" d="M8 1.5c.5 0 .9.28 1.12.72l5.2 10.5a.9.9 0 0 1-.8 1.3h-1.6a.9.9 0 0 1-.8-.5L8 7.1l-3.12 6.42a.9.9 0 0 1-.8.5h-1.6a.9.9 0 0 1-.8-1.3l5.2-10.5c.22-.44.62-.72 1.12-.72Z" />
  </svg>
  <svg v-else viewBox="0 0 16 16" fill="none" aria-hidden="true" class="size-4 text-(--provider-codex)">
    <path d="M8 1.6 13.5 4.8v6.4L8 14.4 2.5 11.2V4.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
    <path d="m5.6 6.6 1.9 1.4-1.9 1.4M8.6 10h1.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
