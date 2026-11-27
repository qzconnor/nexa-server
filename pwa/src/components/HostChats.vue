<script setup lang="ts">
import { LoaderCircle, MessagesSquare, Pin, Search, SearchX } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { shortTime } from '../format'
import { host } from '../host'
import { isUnread } from '../shared/chat'
import type { SessionMeta } from '../shared/types'
import ChatMark, { type ChatState } from './ChatMark.vue'

/**
 * The chats of a computer, the latest first (pinned on top), in the glass of the bars: each with its CLI's
 * mark and what it does now as a badge on it, like a messenger's list.
 */
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

function stateOf(meta: SessionMeta): ChatState {
  const { status } = host.runtime(meta.id)
  if (status === 'waiting') return 'waiting'
  if (status === 'running' || status === 'starting') return 'running'
  if (status === 'error') return 'error'
  return isUnread(meta) ? 'unread' : null
}
</script>

<template>
  <section aria-label="Chats" class="space-y-3">
    <label class="glass bar-round pane-edge flex h-11 items-center gap-2.5 border border-foreground/10 px-4 transition-colors focus-within:border-ring/60">
      <Search class="size-4 shrink-0 text-muted-foreground" />
      <input
        v-model="query"
        type="search"
        class="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        placeholder="Chats durchsuchen"
        aria-label="Chats durchsuchen"
      />
    </label>

    <div v-if="host.list.error" class="glass card-round pane-edge space-y-3 border border-foreground/10 px-4 py-3 text-sm">
      <p class="text-destructive">{{ host.list.error }}</p>
      <button type="button" class="btn btn-outline h-8" @click="host.load()">Erneut versuchen</button>
    </div>
    <div v-else-if="!host.list.loaded" class="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <LoaderCircle class="size-4 animate-spin" />
      Lädt die Chats …
    </div>
    <div v-else-if="!chats.length" class="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <component :is="query ? SearchX : MessagesSquare" class="size-7 text-muted-foreground" />
      <p class="font-medium">{{ query ? 'Kein Chat passt' : 'Noch keine Chats' }}</p>
      <p class="max-w-xs text-sm text-muted-foreground">
        {{ query ? 'Gesucht wird in Titel, Projekt und letzter Nachricht.' : 'Chats, die du auf diesem Computer anfängst, erscheinen hier.' }}
      </p>
    </div>
    <ul v-else class="glass card-round pane-edge border border-foreground/10 p-1.5">
      <li v-for="(meta, i) in chats.slice(0, limit)" :key="meta.id">
        <!-- Inset as far as the text, as in a phone's lists: the marks stand on their own. -->
        <div v-if="i > 0" class="mr-3 ml-[3.9rem] h-px bg-foreground/[0.07]" aria-hidden="true" />
        <RouterLink
          :to="`/chats/${instance}/${meta.id}`"
          class="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2.5 transition-colors hover:bg-foreground/5 active:bg-foreground/10"
        >
          <ChatMark :provider="meta.provider" :state="stateOf(meta)" />
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate" :class="stateOf(meta) === 'unread' ? 'font-semibold' : 'font-medium'">{{ meta.title }}</span>
              <Pin v-if="meta.pinned" class="size-3 shrink-0 self-center text-muted-foreground" aria-label="Angeheftet" />
              <span class="shrink-0 text-xs tabular-nums" :class="stateOf(meta) === 'unread' ? 'text-primary' : 'text-muted-foreground'">
                {{ shortTime(meta.updatedAt) }}
              </span>
            </span>
            <span class="mt-0.5 flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {{ projectNames.get(meta.projectId) ?? 'Ohne Projekt' }}<template v-if="meta.preview"> · {{ meta.preview }}</template>
              </span>
              <span v-if="stateOf(meta) === 'unread'" class="size-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            </span>
          </span>
        </RouterLink>
      </li>
    </ul>
    <button
      v-if="chats.length > limit"
      type="button"
      class="glass bar-round pane-edge h-11 w-full border border-foreground/10 text-sm text-muted-foreground transition-colors hover:text-foreground"
      @click="limit += PAGE"
    >
      Weitere {{ Math.min(PAGE, chats.length - limit) }} von {{ chats.length - limit }} anzeigen
    </button>
  </section>
</template>
