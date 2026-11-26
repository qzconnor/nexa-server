<script setup lang="ts">
import { CloudOff, LoaderCircle } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { link } from '../client'
import { linkState } from '../link'

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
// Ticks only while it counts down to the next attempt.
watch(
  () => linkState.value.retryAt,
  (retryAt) => {
    if (timer) clearInterval(timer)
    timer = retryAt ? setInterval(() => (now.value = Date.now()), 1000) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => timer && clearInterval(timer))

const visible = computed(() => {
  const { status, error } = linkState.value
  return status === 'connecting' || status === 'offline' || status === 'stopped' || (status === 'unpaired' && error !== null)
})
const text = computed(() => {
  const { status, error, retryAt } = linkState.value
  if (error) return error
  if (status === 'connecting') return 'Verbinde mit dem Server …'
  if (status === 'offline') {
    const seconds = retryAt ? Math.max(0, Math.ceil((retryAt - now.value) / 1000)) : null
    return seconds ? `Keine Verbindung zum Server. Nächster Versuch in ${seconds} s.` : 'Keine Verbindung zum Server.'
  }
  return 'Nicht mit dem Server verbunden.'
})
const canRetry = computed(() => linkState.value.status === 'offline' || linkState.value.status === 'stopped')
</script>

<template>
  <div
    v-if="visible"
    role="status"
    class="flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm"
    :class="linkState.error ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-card'"
  >
    <LoaderCircle v-if="linkState.status === 'connecting'" class="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
    <CloudOff v-else class="mt-0.5 size-4 shrink-0" :class="linkState.error ? 'text-destructive' : 'text-muted-foreground'" />
    <p class="min-w-0 flex-1">{{ text }}</p>
    <button v-if="canRetry" type="button" class="shrink-0 font-medium text-primary" @click="link.reconnect()">Neu verbinden</button>
  </div>
</template>
