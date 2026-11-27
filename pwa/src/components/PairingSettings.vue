<script setup lang="ts">
import { LoaderCircle, LogOut } from '@lucide/vue'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { link } from '../client'
import { isPaired, linkState } from '../link'

const STATUS: Record<string, string> = {
  connecting: 'Verbinde …',
  online: 'Verbunden',
  offline: 'Keine Verbindung',
  stopped: 'Getrennt',
}

const paired = computed(() => isPaired(linkState.value))
const confirming = ref(false)
const leaving = ref(false)

async function unpair(): Promise<void> {
  leaving.value = true
  try {
    await link.unpair()
  } finally {
    leaving.value = false
    confirming.value = false
  }
}
</script>

<template>
  <section aria-labelledby="settings-pairing" class="space-y-2">
    <h2 id="settings-pairing" class="px-1 font-semibold">Kopplung</h2>

    <div v-if="!paired" class="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <span class="text-muted-foreground">{{ linkState.status === 'loading' ? '…' : 'Nicht gekoppelt' }}</span>
      <RouterLink v-if="linkState.status === 'unpaired'" to="/setup" class="font-medium text-primary">Koppeln</RouterLink>
    </div>

    <template v-else>
      <dl class="divide-y divide-border rounded-xl border border-border bg-card text-sm">
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted-foreground">Dieses Gerät</dt>
          <dd class="truncate">{{ linkState.name }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted-foreground">Namespace</dt>
          <dd class="truncate">{{ linkState.namespace }}</dd>
        </div>
        <div class="flex justify-between gap-4 px-4 py-3">
          <dt class="text-muted-foreground">Verbindung</dt>
          <dd>{{ STATUS[linkState.status] }}</dd>
        </div>
      </dl>

      <h3 class="px-1 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Geräte im Namespace</h3>
      <ul class="divide-y divide-border rounded-xl border border-border bg-card text-sm">
        <li v-for="device in linkState.devices" :key="device.id" class="flex items-center gap-3 px-4 py-3">
          <span
            class="size-2 shrink-0 rounded-full"
            :class="device.online ? 'bg-success' : 'bg-muted-foreground/40'"
            :aria-label="device.online ? 'online' : 'offline'"
          />
          <span class="min-w-0 flex-1 truncate">{{ device.name }}</span>
          <span class="shrink-0 text-muted-foreground">
            {{ device.self ? 'dieses Gerät' : device.role === 'host' ? 'Computer' : 'Steuerung' }}
          </span>
        </li>
      </ul>

      <div class="rounded-xl border border-border bg-card p-4 text-sm">
        <template v-if="!confirming">
          <button type="button" class="flex items-center gap-2 font-medium text-destructive" @click="confirming = true">
            <LogOut class="size-4" />
            Abmelden
          </button>
        </template>
        <template v-else>
          <p class="mb-3">
            Dieses Gerät verlässt den Namespace und vergisst seine Schlüssel. Danach brauchst du einen neuen
            Kopplungscode.
          </p>
          <div class="flex gap-2">
            <button
              type="button"
              :disabled="leaving"
              class="flex h-9 items-center gap-2 rounded-lg bg-destructive px-3 font-medium text-white disabled:opacity-50"
              @click="unpair"
            >
              <LoaderCircle v-if="leaving" class="size-4 animate-spin" />
              Abmelden
            </button>
            <button type="button" class="h-9 rounded-lg px-3 font-medium hover:bg-accent" @click="confirming = false">Abbrechen</button>
          </div>
        </template>
      </div>
    </template>
  </section>
</template>
