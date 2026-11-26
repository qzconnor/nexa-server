<script setup lang="ts">
import { ChevronRight, LoaderCircle, Monitor } from '@lucide/vue'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import HostChats from '../components/HostChats.vue'
import NotPaired from '../components/NotPaired.vue'
import { computers, computerStatus } from '../computers'
import { linkState } from '../link'

const paired = computed(() => linkState.value.status !== 'unpaired' && linkState.value.status !== 'loading')
const rows = computed(() => computers.value.map((device) => ({ device, status: computerStatus(device) })))
/** The one computer of most namespaces: its chats right here, not a tap away. */
const only = computed(() => (rows.value.length === 1 && rows.value[0]!.status.level ? rows.value[0]!.device : null))
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
      <ul v-if="rows.length" class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <li v-for="{ device, status } in rows" :key="device.id">
          <component
            :is="status.level && !only ? RouterLink : 'div'"
            :to="status.level && !only ? `/chats/${device.id}` : undefined"
            class="flex items-start gap-3 px-4 py-3"
            :class="{ 'hover:bg-accent': status.level && !only }"
          >
            <span
              class="mt-1.5 size-2 shrink-0 rounded-full"
              :class="device.online && device.trusted ? 'bg-success' : device.online ? 'bg-warning' : 'bg-muted-foreground/40'"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ device.name }}</span>
              <span class="flex items-center gap-1.5 text-sm" :class="status.tone">
                <LoaderCircle v-if="status.asking" class="size-3.5 shrink-0 animate-spin" />
                {{ status.text }}
              </span>
            </span>
            <ChevronRight v-if="status.level && !only" class="mt-1 size-4 shrink-0 text-muted-foreground" />
          </component>
        </li>
      </ul>
      <p v-else class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        Im Namespace ist noch kein Computer. Koppel Nexa auf dem Computer mit demselben Server.
      </p>
    </section>
    <HostChats v-if="only" :instance="only.id" />
  </div>
</template>
