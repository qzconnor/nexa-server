<script setup lang="ts">
import { CircleAlert, CircleCheck, Hand, LoaderCircle, MonitorOff } from '@lucide/vue'
import { computed, type Component } from 'vue'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import InboxEntry from '../components/InboxEntry.vue'
import { computerById, computers } from '../computers'
import { inbox } from '../inbox'
import { isPaired, linkState } from '../link'
import { INBOX_SECTIONS, type InboxSection } from '../shared/inbox'

/** What waits on the computers, all of them in one list: questions to answer, what broke, what is done. */
const SECTIONS: Record<InboxSection, { title: string; icon: Component; tone: string }> = {
  waiting: { title: 'Wartet auf dich', icon: Hand, tone: 'text-primary' },
  trouble: { title: 'Fehler und Limit', icon: CircleAlert, tone: 'text-destructive' },
  unread: { title: 'Fertig, ungelesen', icon: CircleCheck, tone: 'text-success' },
  running: { title: 'Läuft gerade', icon: LoaderCircle, tone: 'text-muted-foreground' },
}

const paired = computed(() => isPaired(linkState.value))
const listed = computed(() => [...inbox.computers].map(([id, state]) => ({ id, state, name: computerById(id)?.name ?? 'Computer' })))
/** With several computers each entry says which one it is on. */
const many = computed(() => listed.value.length > 1)
const sections = computed(() =>
  INBOX_SECTIONS.filter((id) => inbox.sections.value[id].length).map((id) => {
    const rows = inbox.sections.value[id]
    return { id, ...SECTIONS[id], rows, asking: rows.some((row) => row.entry.pending?.length) }
  }),
)
const failed = computed(() => listed.value.filter((c) => c.state.error))
const loading = computed(() => listed.value.some((c) => !c.state.loaded && !c.state.error))
const answered = computed(() => listed.value.length > 0 && !loading.value && !sections.value.length && !failed.value.length)
/**
 * Computers there are, but none in the inbox (offline, nothing allowed): one line for all, not a list.
 * Only once connected; before that, every computer is just „unknown“.
 */
const unreachable = computed(() => linkState.value.status === 'online' && computers.value.length > 0 && !listed.value.length)
</script>

<template>
  <!-- A column as high as the page, so what stands alone (nothing waits, nobody there) sits in its middle. -->
  <div class="mx-auto flex min-h-full max-w-xl flex-col gap-6 p-4">
    <ConnectionBanner />
    <template v-if="paired">
      <p v-if="!computers.length" class="glass card-round pane-edge border border-foreground/10 px-4 py-3 text-sm text-muted-foreground">
        Im Namespace ist noch kein Computer. Koppel Nexa auf dem Computer mit demselben Server.
      </p>

      <div v-for="c in failed" :key="c.id" class="glass card-round pane-edge space-y-3 border border-foreground/10 px-4 py-3 text-sm">
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
        <!-- Chats with questions each a pane of their own, they grow with what they ask; the others share one, as the list of chats. -->
        <div v-if="section.asking" class="space-y-3">
          <InboxEntry
            v-for="row in section.rows"
            :key="`${row.instance}:${row.entry.id}`"
            :row="row"
            :show-computer="many"
            class="glass card-round pane-edge border border-foreground/10 p-1.5"
          />
        </div>
        <ul v-else class="glass card-round pane-edge border border-foreground/10 p-1.5">
          <li v-for="(row, i) in section.rows" :key="`${row.instance}:${row.entry.id}`">
            <div v-if="i > 0" class="mr-3 ml-[3.9rem] h-px bg-foreground/[0.07]" aria-hidden="true" />
            <InboxEntry :row="row" :show-computer="many" />
          </li>
        </ul>
      </section>

      <div v-if="loading && !sections.length" class="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle class="size-4 animate-spin" />
        Fragt die Computer …
      </div>
      <div v-else-if="answered" class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <CircleCheck class="size-7 text-success" />
        <p class="font-medium">Nichts wartet auf dich</p>
        <p class="max-w-xs text-sm text-muted-foreground">Was deine Agents fragen, was abbricht und was fertig wird, erscheint hier.</p>
      </div>
      <div v-else-if="unreachable" class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <MonitorOff class="size-7 text-muted-foreground" />
        <p class="font-medium">Gerade ist kein Computer erreichbar</p>
        <p class="max-w-xs text-sm text-muted-foreground">
          Sobald einer online ist und diesem Gerät mindestens das Mitlesen erlaubt, steht hier, was wartet.
        </p>
      </div>
    </template>
  </div>
</template>
