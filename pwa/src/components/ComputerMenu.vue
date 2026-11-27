<script setup lang="ts">
import { Check, LoaderCircle } from '@lucide/vue'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { chooseComputer, computerDot, computers, computerStatus, shownComputer } from '../computers'
import FloatingPane from './FloatingPane.vue'

/**
 * The computers of the namespace in a pane under the header, each with its dot and what it allows: the one
 * picked is the one whose chats the chats tab shows, here and next time.
 */
const open = defineModel<boolean>('open', { required: true })
const route = useRoute()
const router = useRouter()

const rows = computed(() => computers.value.map((device) => ({ device, status: computerStatus(device) })))

function pick(id: string): void {
  chooseComputer(id)
  open.value = false
  if (route.name !== 'chats') void router.push({ name: 'chats' })
}
</script>

<template>
  <FloatingPane v-model:open="open" label="Computer wählen" side="below">
    <div class="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
      <p class="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Computer</p>
      <button
        v-for="{ device, status } in rows"
        :key="device.id"
        type="button"
        class="menu-row h-auto py-2.5"
        :aria-current="device.id === shownComputer?.id ? 'true' : undefined"
        @click="pick(device.id)"
      >
        <LoaderCircle v-if="status.asking" class="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        <span v-else class="size-2.5 shrink-0 rounded-full" :class="computerDot(device)" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ device.name }}</span>
          <span class="block truncate text-[0.8rem]" :class="status.tone">{{ status.text }}</span>
        </span>
        <Check v-if="device.id === shownComputer?.id" class="size-4 shrink-0 text-primary" />
      </button>
    </div>
  </FloatingPane>
</template>
