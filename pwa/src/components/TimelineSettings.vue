<script setup lang="ts">
import type { UnfoldSettings } from './chat/unfold'
import { unfoldSettings } from '../unfold-settings'
import ToggleSwitch from './ToggleSwitch.vue'

const ROWS: { key: keyof UnfoldSettings; label: string; hint: string }[] = [
  { key: 'commands', label: 'Befehle', hint: 'Der ganze Befehl mit seiner Ausgabe.' },
  {
    key: 'changes',
    label: 'Änderungen',
    hint: 'Der Diff geänderter Dateien. Bleibt zu, wenn der Computer unter Einstellungen › Chat „Änderungen eingeklappt“ hat.',
  },
  { key: 'failures', label: 'Fehler', hint: 'Was bei einem Werkzeug schiefging.' },
  { key: 'thinking', label: 'Gedanken', hint: 'Was der Agent beim Nachdenken schreibt.' },
]
</script>

<template>
  <section aria-labelledby="settings-unfold" class="space-y-2">
    <div class="px-1">
      <h2 id="settings-unfold" class="font-semibold">Chatverlauf</h2>
      <p class="text-sm text-muted-foreground">
        Was im Verlauf eines Chats von selbst aufgeklappt ist. Ein Tipp klappt jedes einzeln auf und zu. Gilt nur auf
        diesem Gerät.
      </p>
    </div>
    <div class="divide-y divide-border rounded-xl border border-border bg-card text-sm">
      <label v-for="row in ROWS" :key="row.key" class="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
        <span class="min-w-0">
          {{ row.label }}
          <span class="block text-muted-foreground">{{ row.hint }}</span>
        </span>
        <ToggleSwitch v-model="unfoldSettings[row.key]" />
      </label>
    </div>
  </section>
</template>
