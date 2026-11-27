<script setup lang="ts">
import { ChevronRight, CircleAlert, CircleHelp, LoaderCircle } from '@lucide/vue'
import { computed, provide } from 'vue'
import { RouterLink } from 'vue-router'
import { computerById, computerStatus } from '../computers'
import { resumeText, shortTime } from '../format'
import { inbox } from '../inbox'
import type { InboxRow } from '../inbox-store'
import { levelAllows } from '../shared/remote'
import InteractionCard from './chat/InteractionCard.vue'
import { RESPONDER } from './chat/respond'

/** A chat of the inbox: a link to it, and what it waits for, answered right here. */
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

const STATE_LABEL = { waiting: 'Wartet auf dich', trouble: 'Fehler oder Limit', unread: 'Ungelesen', running: 'Arbeitet' } as const
</script>

<template>
  <article class="overflow-hidden rounded-xl border border-border bg-card">
    <RouterLink :to="`/chats/${row.instance}/${entry.id}`" class="flex items-start gap-3 px-3 py-2.5 hover:bg-accent">
      <span class="mt-1 flex size-4 shrink-0 items-center justify-center" :title="STATE_LABEL[entry.section]">
        <CircleHelp v-if="entry.section === 'waiting'" class="size-4 text-warning" />
        <CircleAlert v-else-if="entry.section === 'trouble'" class="size-4 text-destructive" />
        <span v-else-if="entry.section === 'unread'" class="size-2 rounded-full bg-primary" />
        <LoaderCircle v-else class="size-4 animate-spin text-primary" />
        <span class="sr-only">{{ STATE_LABEL[entry.section] }}</span>
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate" :class="entry.section === 'unread' ? 'font-semibold' : 'font-medium'">{{ entry.title }}</span>
          <span class="shrink-0 text-xs text-muted-foreground">{{ shortTime(entry.updatedAt) }}</span>
        </span>
        <span class="block truncate text-sm text-muted-foreground">{{ place }}</span>
        <span v-if="entry.error" class="mt-1 line-clamp-3 block text-sm break-words text-destructive">{{ entry.error }}</span>
        <span v-if="entry.resume" class="mt-1 block text-sm text-warning">{{ resumeText(entry.resume) }}</span>
      </span>
      <ChevronRight class="mt-1 size-4 shrink-0 text-muted-foreground" />
    </RouterLink>
    <div v-if="pending.length" class="space-y-2 border-t border-border p-2">
      <InteractionCard v-for="item in pending" :key="item.id" :item="item" />
    </div>
  </article>
</template>
