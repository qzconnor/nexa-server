<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { computed, provide } from 'vue'
import { RouterLink } from 'vue-router'
import { computerById, computerStatus } from '../computers'
import { resumeText, shortTime } from '../format'
import { inbox } from '../inbox'
import type { InboxRow } from '../inbox-store'
import type { InboxSection } from '../shared/inbox'
import { levelAllows } from '../shared/remote'
import ChatMark, { type ChatState } from './ChatMark.vue'
import InteractionCard from './chat/InteractionCard.vue'
import { RESPONDER } from './chat/respond'

/**
 * A chat of the inbox: a row as in the list of chats, a link to it, and what it waits for beneath it,
 * answered right here. Framed by the page: a pane of glass of its own, or a row of a shared one.
 */
const props = defineProps<{ row: InboxRow; showComputer?: boolean }>()

const device = computed(() => computerById(props.row.instance))
const level = computed(() => (device.value ? computerStatus(device.value).level : null))
const entry = computed(() => props.row.entry)
const pending = computed(() => entry.value.pending ?? [])

provide(RESPONDER, {
  allowed: () => level.value !== null && levelAllows(level.value, 'full'),
  respond: (itemId, response) => inbox.respond(props.row.instance, entry.value.id, itemId, response),
})

const place = computed(() =>
  [props.showComputer ? device.value?.name : null, props.row.project ?? 'Ohne Projekt', entry.value.preview].filter(Boolean).join(' · '),
)

const STATE: Record<InboxSection, ChatState> = { waiting: 'waiting', trouble: 'error', unread: 'unread', running: 'running' }
const unread = computed(() => entry.value.section === 'unread')
</script>

<template>
  <div>
    <RouterLink
      :to="`/chats/${row.instance}/${entry.id}`"
      class="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2.5 transition-colors hover:bg-foreground/5 active:bg-foreground/10"
    >
      <ChatMark :provider="entry.provider" :state="STATE[entry.section]" />
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate" :class="unread ? 'font-semibold' : 'font-medium'">{{ entry.title }}</span>
          <span class="shrink-0 text-xs tabular-nums" :class="unread ? 'text-primary' : 'text-muted-foreground'">{{ shortTime(entry.updatedAt) }}</span>
        </span>
        <span class="mt-0.5 flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{{ place }}</span>
          <span v-if="unread" class="size-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        </span>
        <span v-if="entry.error" class="mt-1 line-clamp-3 block text-sm break-words text-destructive">{{ entry.error }}</span>
        <span v-if="entry.resume" class="mt-1 block text-sm text-warning">{{ resumeText(entry.resume) }}</span>
      </span>
      <ChevronRight class="size-4 shrink-0 text-muted-foreground" />
    </RouterLink>
    <template v-for="item in pending" :key="item.id">
      <div class="mx-2.5 h-px bg-foreground/[0.07]" aria-hidden="true" />
      <InteractionCard :item="item" flat />
    </template>
  </div>
</template>
