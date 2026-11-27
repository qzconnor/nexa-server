<script setup lang="ts">
import { LoaderCircle, Monitor, MonitorOff } from '@lucide/vue'
import { computed } from 'vue'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import HostChats from '../components/HostChats.vue'
import NotPaired from '../components/NotPaired.vue'
import { computerDot, computers, computerStatus, computerTitle, shownComputer } from '../computers'
import { linkState } from '../link'
import { usePageTitle } from '../page-title'

/**
 * The chats of one computer: the only one, or the one picked in the header's menu. Its name sits in the
 * header, not in a card above them.
 */
const paired = computed(() => linkState.value.status !== 'unpaired' && linkState.value.status !== 'loading')
const shown = shownComputer
const status = computed(() => (shown.value ? computerStatus(shown.value) : null))
usePageTitle(() => (shown.value ? computerTitle(shown.value) : null))

/** Several computers, none of them usable yet: each with why, until one is. */
const rows = computed(() => computers.value.map((device) => ({ device, status: computerStatus(device) })))
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 p-4">
    <ConnectionBanner />
    <NotPaired v-if="linkState.status === 'unpaired'" />
    <template v-else-if="paired">
      <template v-if="shown && status">
        <HostChats v-if="status.level" :instance="shown.id" />
        <div v-else class="flex flex-col items-center gap-2 px-4 py-16 text-center">
          <LoaderCircle v-if="status.asking" class="size-7 animate-spin text-muted-foreground" />
          <component :is="shown.online ? Monitor : MonitorOff" v-else class="size-7 text-muted-foreground" />
          <p class="font-medium">{{ shown.name }}</p>
          <p class="max-w-xs text-sm" :class="status.tone">{{ status.text }}</p>
          <p v-if="computers.length > 1" class="max-w-xs text-sm text-muted-foreground">Einen anderen Computer wählst du oben rechts.</p>
        </div>
      </template>
      <section v-else aria-labelledby="chats-computers">
        <h2
          id="chats-computers"
          class="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          <Monitor class="size-4" />
          Computer
        </h2>
        <ul v-if="rows.length" class="glass card-round pane-edge border border-foreground/10 p-1.5">
          <li v-for="({ device, status: row }, i) in rows" :key="device.id">
            <div v-if="i > 0" class="mx-3 h-px bg-foreground/[0.07]" aria-hidden="true" />
            <div class="flex items-start gap-3 px-2.5 py-2.5">
              <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="computerDot(device)" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ device.name }}</span>
                <span class="flex items-center gap-1.5 text-sm" :class="row.tone">
                  <LoaderCircle v-if="row.asking" class="size-3.5 shrink-0 animate-spin" />
                  {{ row.text }}
                </span>
              </span>
            </div>
          </li>
        </ul>
        <p v-else class="glass card-round pane-edge border border-foreground/10 px-4 py-3 text-sm text-muted-foreground">
          Im Namespace ist noch kein Computer. Koppel Nexa auf dem Computer mit demselben Server.
        </p>
      </section>
    </template>
  </div>
</template>
