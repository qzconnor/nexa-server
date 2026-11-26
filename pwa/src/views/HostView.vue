<script setup lang="ts">
import { computed } from 'vue'
import ConnectionBanner from '../components/ConnectionBanner.vue'
import HostChats from '../components/HostChats.vue'
import { computerById, computerStatus } from '../computers'
import { usePageTitle } from '../page-title'

/** The chats of one computer (with several in the namespace; with one, the chats tab shows them itself). */
const props = defineProps<{ host: string }>()

const device = computed(() => computerById(props.host))
const status = computed(() => (device.value ? computerStatus(device.value) : null))
usePageTitle(() => device.value?.name)
</script>

<template>
  <div class="mx-auto max-w-xl space-y-4 p-4">
    <ConnectionBanner />
    <p v-if="!device" class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
      Diesen Computer gibt es im Namespace nicht mehr.
    </p>
    <p v-else-if="!status?.level" class="rounded-lg border border-border bg-card px-3 py-3 text-sm" :class="status?.tone">{{ status?.text }}</p>
    <HostChats v-else :instance="host" />
  </div>
</template>
