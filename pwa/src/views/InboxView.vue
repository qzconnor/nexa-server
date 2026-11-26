<script setup lang="ts">
import { CircleAlert, CircleCheck, Hand, LoaderCircle } from '@lucide/vue'
import type { Component } from 'vue'
import NotPaired from '../components/NotPaired.vue'
import { INBOX_SECTIONS, type InboxSection } from '../shared/inbox'

const SECTIONS: Record<InboxSection, { title: string; empty: string; icon: Component; tone: string }> = {
  waiting: { title: 'Wartet auf dich', empty: 'Keine Rückfragen, Freigaben oder Pläne offen.', icon: Hand, tone: 'text-primary' },
  trouble: { title: 'Fehler und Limit', empty: 'Kein Chat ist abgebrochen.', icon: CircleAlert, tone: 'text-destructive' },
  unread: { title: 'Fertig, ungelesen', empty: 'Alles gelesen.', icon: CircleCheck, tone: 'text-success' },
  running: { title: 'Läuft gerade', empty: 'Gerade arbeitet kein Chat.', icon: LoaderCircle, tone: 'text-muted-foreground' },
}
// In the app's order (sessions:inbox sorts the same way): what blocks a chat first.
const sections = INBOX_SECTIONS.map((id) => ({ id, ...SECTIONS[id] }))
</script>

<template>
  <div class="mx-auto max-w-xl space-y-6 p-4">
    <NotPaired />
    <section v-for="section in sections" :key="section.id" :aria-labelledby="`inbox-${section.id}`">
      <h2
        :id="`inbox-${section.id}`"
        class="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        <component :is="section.icon" class="size-4" :class="section.tone" />
        {{ section.title }}
      </h2>
      <p class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{{ section.empty }}</p>
    </section>
  </div>
</template>
