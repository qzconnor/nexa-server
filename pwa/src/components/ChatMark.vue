<script lang="ts">
export type ChatState = 'running' | 'waiting' | 'error' | 'unread' | null
</script>

<script setup lang="ts">
import { CircleAlert, CircleHelp, LoaderCircle } from '@lucide/vue'
import type { ProviderId } from '../shared/chat'
import ProviderIcon from './ProviderIcon.vue'

/**
 * A chat's mark in the lists (chats, inbox): its CLI's sign on a disc of glass, what it does now as a badge
 * on it. Unread has no badge; the rows show it in their text.
 */
defineProps<{ provider: ProviderId; state: ChatState }>()

const STATE_LABEL: Record<Exclude<ChatState, null>, string> = {
  running: 'Arbeitet',
  waiting: 'Wartet auf eine Antwort',
  error: 'Fehler',
  unread: 'Ungelesen',
}
</script>

<template>
  <span class="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-foreground/[0.06]">
    <ProviderIcon :provider="provider" />
    <span
      v-if="state && state !== 'unread'"
      class="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border border-foreground/10 bg-popover"
      :title="STATE_LABEL[state]"
    >
      <LoaderCircle v-if="state === 'running'" class="size-3.5 animate-spin text-primary" />
      <CircleHelp v-else-if="state === 'waiting'" class="size-3.5 text-warning" />
      <CircleAlert v-else class="size-3.5 text-destructive" />
    </span>
    <span v-if="state" class="sr-only">{{ STATE_LABEL[state] }}</span>
  </span>
</template>
