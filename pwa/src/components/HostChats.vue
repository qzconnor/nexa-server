<script setup lang="ts">
import { CircleAlert, CircleHelp, LoaderCircle, Pin, Search } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { shortTime } from '../format'
import { host } from '../host'
import { isUnread } from '../shared/chat'
import type { SessionMeta } from '../shared/types'

/** The chats of a computer, the latest first (pinned on top), each with what it does now. */
const props = defineProps<{ instance: string }>()

watch(
  () => props.instance,
  (id) => void host.show(id),
  { immediate: true },
)

/** Rows at first: a phone needn't lay out hundreds of chats to show the top of the list. */
const PAGE = 50
const query = ref('')
const limit = ref(PAGE)
watch(query, () => (limit.value = PAGE))

const projectNames = computed(() => new Map(host.projects.value.map((p) => [p.id, p.name])))
const chats = computed(() => {
  if (host.instance.value !== props.instance) return []
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  return host.sessions.value
    .filter((m) => !m.archived)
    .filter((m) => {
      if (!words.length) return true
      const text = `${m.title} ${projectNames.value.get(m.projectId) ?? ''} ${m.preview ?? ''}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
})

type ChatState = 'running' | 'waiting' | 'error' | 'unread' | null

function stateOf(meta: SessionMeta): ChatState {
  const { status } = host.runtime(meta.id)
  if (status === 'waiting') return 'waiting'
  if (status === 'running' || status === 'starting') return 'running'
  if (status === 'error') return 'error'
  return isUnread(meta) ? 'unread' : null
}

const STATE_LABEL: Record<Exclude<ChatState, null>, string> = {
  running: 'Arbeitet',
  waiting: 'Wartet auf eine Antwort',
  error: 'Fehler',
  unread: 'Ungelesen',
}
</script>

<template>
  <section aria-label="Chats" class="space-y-3">
    <label class="flex items-center gap-2 rounded-xl border border-input bg-card px-3 focus-within:ring-2 focus-within:ring-ring/50">
      <Search class="size-4 shrink-0 text-muted-foreground" />
      <input
        v-model="query"
        type="search"
        class="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        placeholder="Chats durchsuchen"
        aria-label="Chats durchsuchen"
      />
    </label>

    <div v-if="host.list.error" class="space-y-3 rounded-lg border border-border bg-card px-3 py-3 text-sm">
      <p class="text-destructive">{{ host.list.error }}</p>
      <button type="button" class="rounded-md border border-border px-3 py-1.5 hover:bg-accent" @click="host.load()">Erneut versuchen</button>
    </div>
    <div v-else-if="!host.list.loaded" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <LoaderCircle class="size-4 animate-spin" />
      Lädt die Chats …
    </div>
    <p v-else-if="!chats.length" class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
      {{ query ? 'Kein Chat passt.' : 'Auf diesem Computer gibt es noch keine Chats.' }}
    </p>
    <ul v-else class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      <li v-for="meta in chats.slice(0, limit)" :key="meta.id">
        <RouterLink :to="`/chats/${instance}/${meta.id}`" class="flex items-start gap-3 px-3 py-2.5 hover:bg-accent">
          <span class="mt-1 flex size-4 shrink-0 items-center justify-center" :title="stateOf(meta) ? STATE_LABEL[stateOf(meta)!] : undefined">
            <LoaderCircle v-if="stateOf(meta) === 'running'" class="size-4 animate-spin text-primary" />
            <CircleHelp v-else-if="stateOf(meta) === 'waiting'" class="size-4 text-warning" />
            <CircleAlert v-else-if="stateOf(meta) === 'error'" class="size-4 text-destructive" />
            <span v-else-if="stateOf(meta) === 'unread'" class="size-2 rounded-full bg-primary" />
            <span v-if="stateOf(meta)" class="sr-only">{{ STATE_LABEL[stateOf(meta)!] }}</span>
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate" :class="stateOf(meta) === 'unread' ? 'font-semibold' : 'font-medium'">{{ meta.title }}</span>
              <Pin v-if="meta.pinned" class="size-3 shrink-0 self-center text-muted-foreground" aria-label="Angeheftet" />
              <span class="shrink-0 text-xs text-muted-foreground">{{ shortTime(meta.updatedAt) }}</span>
            </span>
            <span class="block truncate text-sm text-muted-foreground">
              {{ projectNames.get(meta.projectId) ?? 'Ohne Projekt' }}<template v-if="meta.preview"> · {{ meta.preview }}</template>
            </span>
          </span>
        </RouterLink>
      </li>
    </ul>
    <button
      v-if="chats.length > limit"
      type="button"
      class="w-full rounded-lg border border-border bg-card py-2 text-sm text-muted-foreground hover:bg-accent"
      @click="limit += PAGE"
    >
      Weitere {{ Math.min(PAGE, chats.length - limit) }} von {{ chats.length - limit }} anzeigen
    </button>
  </section>
</template>
