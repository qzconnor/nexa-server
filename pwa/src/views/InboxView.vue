<script setup lang="ts">
import { CircleAlert, CircleCheck, Hand, LoaderCircle } from '@lucide/vue'
import { computed, type Component } from 'vue'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import InboxEntry from '../components/InboxEntry.vue'
import NotPaired from '../components/NotPaired.vue'
import { computerById, computers, computerStatus } from '../computers'
import { inbox } from '../inbox'
import { linkState } from '../link'
import { INBOX_SECTIONS, type InboxSection } from '../shared/inbox'

/** What waits on the computers, all of them in one list: questions to answer, what broke, what is done. */
const SECTIONS: Record<InboxSection, { title: string; icon: Component; tone: string }> = {
  waiting: { title: 'Wartet auf dich', icon: Hand, tone: 'text-primary' },
  trouble: { title: 'Fehler und Limit', icon: CircleAlert, tone: 'text-destructive' },
  unread: { title: 'Fertig, ungelesen', icon: CircleCheck, tone: 'text-success' },
  running: { title: 'Läuft gerade', icon: LoaderCircle, tone: 'text-muted-foreground' },
}

const paired = computed(() => linkState.value.status !== 'unpaired' && linkState.value.status !== 'loading')
const listed = computed(() => [...inbox.computers].map(([id, state]) => ({ id, state, name: computerById(id)?.name ?? 'Computer' })))
/** With several computers each entry says which one it is on. */
const many = computed(() => listed.value.length > 1)
const sections = computed(() =>
  INBOX_SECTIONS.filter((id) => inbox.sections.value[id].length).map((id) => ({ id, ...SECTIONS[id], rows: inbox.sections.value[id] })),
)
const failed = computed(() => listed.value.filter((c) => c.state.error))
const loading = computed(() => listed.value.some((c) => !c.state.loaded && !c.state.error))
const answered = computed(() => listed.value.length > 0 && !loading.value && !sections.value.length && !failed.value.length)
/** Not in the inbox (offline, nothing allowed): said once connected, else each one is just „unknown“. */
const away = computed(() =>
  linkState.value.status === 'online'
    ? computers.value.filter((d) => !inbox.computers.has(d.id)).map((device) => ({ device, status: computerStatus(device) }))
    : [],
)
</script>

<template>
  <div class="mx-auto max-w-xl space-y-6 p-4">
    <ConnectionBanner />
    <NotPaired v-if="linkState.status === 'unpaired'" />
    <template v-else-if="paired">
      <p v-if="!computers.length" class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        Im Namespace ist noch kein Computer. Koppel Nexa auf dem Computer mit demselben Server.
      </p>

      <div v-for="c in failed" :key="c.id" class="space-y-3 rounded-lg border border-border bg-card px-3 py-3 text-sm">
        <p><span class="font-medium">{{ c.name }}:</span> <span class="text-destructive">{{ c.state.error }}</span></p>
        <button type="button" class="btn btn-outline h-8" :disabled="c.state.loading" @click="inbox.refresh(c.id)">Erneut versuchen</button>
      </div>

      <section v-for="section in sections" :key="section.id" :aria-labelledby="`inbox-${section.id}`">
        <h2
          :id="`inbox-${section.id}`"
          class="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          <component :is="section.icon" class="size-4" :class="section.tone" />
          {{ section.title }}
          <span class="ml-auto font-normal tabular-nums">{{ section.rows.length }}</span>
        </h2>
        <div class="space-y-2">
          <InboxEntry v-for="row in section.rows" :key="`${row.instance}:${row.entry.id}`" :row="row" :show-computer="many" />
        </div>
      </section>

      <div v-if="loading && !sections.length" class="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle class="size-4 animate-spin" />
        Fragt die Computer …
      </div>
      <div v-else-if="answered" class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-8 text-center">
        <CircleCheck class="size-6 text-success" />
        <p class="font-medium">Nichts wartet auf dich</p>
        <p class="text-sm text-muted-foreground">Was deine Agents fragen, was abbricht und was fertig wird, erscheint hier.</p>
      </div>

      <section v-if="away.length" aria-labelledby="inbox-away">
        <h2 id="inbox-away" class="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {{ listed.length ? 'Nicht in der Inbox' : 'Gerade kein Computer erreichbar' }}
        </h2>
        <ul class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          <li v-for="{ device, status } in away" :key="device.id" class="px-4 py-2.5">
            <span class="block truncate text-sm font-medium">{{ device.name }}</span>
            <span class="flex items-center gap-1.5 text-sm" :class="status.tone">
              <LoaderCircle v-if="status.asking" class="size-3.5 shrink-0 animate-spin" />
              {{ status.text }}
            </span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
