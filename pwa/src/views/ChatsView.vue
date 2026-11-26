<script setup lang="ts">
import { Monitor } from '@lucide/vue'
import { computed } from 'vue'
import type { LinkDevice } from '../client/link-service'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import NotPaired from '../components/NotPaired.vue'
import { ago, issueText } from '../format'
import { hosts, linkState } from '../link'
import { REMOTE_LEVEL_LABELS } from '../shared/remote'

const paired = computed(() => linkState.value.status !== 'unpaired' && linkState.value.status !== 'loading')
const computers = computed(() => linkState.value.devices.filter((device) => device.role === 'host' && !device.self))

/** One line under a computer's name: why it can't be used yet, or what it lets this device do. */
function detail(device: LinkDevice): { text: string; tone: string } {
  const muted = 'text-muted-foreground'
  // The last list can't say who is online now, nor when one went.
  if (linkState.value.status !== 'online') return { text: 'Unbekannt, solange keine Verbindung zum Server besteht.', tone: muted }
  if (!device.trusted) {
    if (device.issue) return { text: issueText(device.issue), tone: 'text-warning' }
    return { text: device.online ? 'Bestätigt dieses Gerät gleich …' : 'Offline; bestätigt dieses Gerät, sobald es online ist.', tone: muted }
  }
  if (!device.online) return { text: device.lastSeen ? `Offline, zuletzt ${ago(device.lastSeen)}` : 'Offline', tone: muted }
  const answer = hosts.get(device.id)
  if (answer?.info) {
    if (!answer.info.enabled) return { text: 'Fernsteuerung ist dort aus (Einstellungen › Geräte).', tone: 'text-warning' }
    return { text: `Freigabe: ${REMOTE_LEVEL_LABELS[answer.info.level]}`, tone: muted }
  }
  if (answer?.error) return { text: answer.error, tone: 'text-destructive' }
  return { text: 'Frage nach, was es erlaubt …', tone: muted }
}
</script>

<template>
  <div class="mx-auto max-w-xl space-y-6 p-4">
    <ConnectionBanner />
    <NotPaired v-if="linkState.status === 'unpaired'" />
    <section v-if="paired" aria-labelledby="chats-computers">
      <h2
        id="chats-computers"
        class="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        <Monitor class="size-4" />
        Computer
      </h2>
      <ul v-if="computers.length" class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <li v-for="device in computers" :key="device.id" class="flex items-start gap-3 px-4 py-3">
          <span
            class="mt-1.5 size-2 shrink-0 rounded-full"
            :class="device.online && device.trusted ? 'bg-success' : device.online ? 'bg-warning' : 'bg-muted-foreground/40'"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ device.name }}</p>
            <p class="text-sm" :class="detail(device).tone">{{ detail(device).text }}</p>
          </div>
        </li>
      </ul>
      <p v-else class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        Im Namespace ist noch kein Computer. Koppel Nexa auf dem Computer mit demselben Server.
      </p>
    </section>
  </div>
</template>
