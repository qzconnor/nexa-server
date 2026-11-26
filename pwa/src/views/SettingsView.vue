<script setup lang="ts">
import { Check, ExternalLink } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import PairingSettings from '../components/PairingSettings.vue'
import type { ServerInfo } from '../shared/nexa-server/protocol'
import { themeId, themes } from '../theme'

const groups = computed(() => [
  { id: 'dark', title: 'Dunkel', themes: themes.filter((t) => t.mode === 'dark') },
  { id: 'light', title: 'Hell', themes: themes.filter((t) => t.mode === 'light') },
])

const host = window.location.host
const server = ref<ServerInfo | null>(null)
const serverError = ref(false)

onMounted(async () => {
  try {
    const response = await fetch('/v1/info', { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    server.value = (await response.json()) as ServerInfo
  } catch {
    serverError.value = true
  }
})
</script>

<template>
  <div class="mx-auto max-w-xl space-y-8 p-4">
    <PairingSettings />

    <section aria-labelledby="settings-theme" class="space-y-4">
      <div class="px-1">
        <h2 id="settings-theme" class="font-semibold">Theme</h2>
        <p class="text-sm text-muted-foreground">Die Themes der Desktop-App. Gilt nur auf diesem Gerät.</p>
      </div>
      <div v-for="group in groups" :key="group.id" class="space-y-2">
        <h3 class="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ group.title }}</h3>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button
            v-for="t in group.themes"
            :key="t.id"
            type="button"
            class="rounded-xl border bg-card p-1.5 text-left transition-colors"
            :class="t.id === themeId ? 'border-primary ring-2 ring-ring' : 'border-border hover:border-muted-foreground'"
            :aria-pressed="t.id === themeId"
            @click="themeId = t.id"
          >
            <div class="flex h-16 flex-col gap-1.5 rounded-lg p-2" :style="{ background: t.colors.background }" aria-hidden="true">
              <div class="flex flex-1 flex-col justify-center gap-1.5 rounded-md px-2" :style="{ background: t.colors.surface }">
                <div class="h-1.5 w-3/4 rounded-full" :style="{ background: t.colors.foreground }" />
                <div class="h-1.5 w-1/2 rounded-full" :style="{ background: t.colors.mutedForeground }" />
              </div>
              <div class="flex gap-1">
                <span class="h-2 w-5 rounded-full" :style="{ background: t.colors.primary }" />
                <span class="size-2 rounded-full" :style="{ background: t.colors.success }" />
                <span class="size-2 rounded-full" :style="{ background: t.colors.warning }" />
                <span class="size-2 rounded-full" :style="{ background: t.colors.destructive }" />
              </div>
            </div>
            <div class="flex items-center justify-between gap-1 px-1 pt-1.5 text-sm">
              <span class="truncate">{{ t.name }}</span>
              <Check v-if="t.id === themeId" class="size-4 shrink-0 text-primary" />
            </div>
          </button>
        </div>
      </div>
    </section>

    <section aria-labelledby="settings-server" class="space-y-2">
      <h2 id="settings-server" class="px-1 font-semibold">Server</h2>
      <dl class="divide-y divide-border rounded-xl border border-border bg-card text-sm">
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted-foreground">Adresse</dt>
          <dd class="truncate">{{ host }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted-foreground">Version</dt>
          <dd v-if="server">nexa-server {{ server.version }}, Protokoll {{ server.protocol }}</dd>
          <dd v-else-if="serverError" class="text-destructive">nicht erreichbar</dd>
          <dd v-else class="text-muted-foreground">…</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="settings-about" class="space-y-2">
      <h2 id="settings-about" class="px-1 font-semibold">Über</h2>
      <div class="rounded-xl border border-border bg-card text-sm">
        <a
          href="https://github.com/qzconnor/nexa-server"
          target="_blank"
          rel="noreferrer"
          class="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
        >
          <span>
            Quellcode
            <span class="block text-muted-foreground">Freie Software unter der AGPL-3.0</span>
          </span>
          <ExternalLink class="size-4 shrink-0 text-muted-foreground" />
        </a>
      </div>
    </section>
  </div>
</template>
