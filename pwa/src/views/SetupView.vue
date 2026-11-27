<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { link } from '../client'
import { guessDeviceName } from '../device-name'
import { linkState, pendingPairingCode } from '../link'
import { decodePairingCode } from '../shared/nexa-server/pairing-code'

/**
 * The only page there is while this device is not paired (router.ts): what Nexa needs from the
 * computer and the form for it, on its own, without header and dock.
 */
const router = useRouter()
// From a QR code's link; taken once, so it doesn't linger in memory after this page.
const fromLink = pendingPairingCode.value !== null
const code = ref(pendingPairingCode.value ?? '')
pendingPairingCode.value = null
const name = ref(guessDeviceName())
const busy = ref(false)
const error = ref<string | null>(null)

const decoded = computed(() => decodePairingCode(code.value.trim()))
const icon = `${import.meta.env.BASE_URL}icon.svg`

const STEPS = [
  'Öffne Nexa auf deinem Computer, dort Einstellungen › Geräte › „Gerät hinzufügen“.',
  'Scanne den QR-Code mit der Kamera dieses Geräts oder kopiere den Kopplungscode hierher.',
  'Gib dem Gerät einen Namen und tippe auf „Koppeln“.',
]

async function pair(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    await link.pair({ code: code.value, name: name.value })
    code.value = ''
    await router.replace('/chats')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="pt-safe pb-safe px-safe mx-auto flex min-h-full max-w-md flex-col justify-center">
    <div class="space-y-6 px-4 py-10">
      <header class="flex flex-col items-center gap-3 text-center">
        <img :src="icon" alt="" class="size-16" />
        <h1 class="text-2xl font-semibold">Nexa einrichten</h1>
        <p class="max-w-xs text-sm text-muted-foreground">
          Koppel dieses Gerät mit Nexa auf deinem Computer. Danach siehst du hier deine Chats und beantwortest Rückfragen
          von unterwegs.
        </p>
      </header>

      <ol class="glass card-round pane-edge space-y-3 border border-foreground/10 px-4 py-3.5 text-sm">
        <li v-for="(step, i) in STEPS" :key="i" class="flex gap-3">
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary tabular-nums"
            aria-hidden="true"
          >
            {{ i + 1 }}
          </span>
          <span class="pt-0.5">{{ step }}</span>
        </li>
      </ol>

      <form class="glass card-round pane-edge space-y-4 border border-foreground/10 p-4" @submit.prevent="pair">
        <label class="block space-y-1.5">
          <span class="text-sm font-medium">Kopplungscode</span>
          <textarea
            v-model="code"
            rows="4"
            required
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="nexa1:…"
            class="field resize-none font-mono text-xs break-all"
          />
          <span v-if="decoded" class="block text-xs text-muted-foreground">
            <template v-if="fromLink">Aus dem Link übernommen. </template>Server: {{ decoded.url }}
          </span>
          <span v-else class="block text-xs text-muted-foreground">Er gilt einmal und 15 Minuten.</span>
        </label>

        <label class="block space-y-1.5">
          <span class="text-sm font-medium">Name dieses Geräts</span>
          <input v-model="name" required maxlength="64" autocomplete="off" class="field" />
          <span class="block text-xs text-muted-foreground">So steht es auf deinen anderen Geräten in der Liste.</span>
        </label>

        <p
          v-if="error || linkState.error"
          role="alert"
          class="rounded-[0.75rem] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {{ error ?? linkState.error }}
        </p>

        <button type="submit" class="btn btn-primary h-11 w-full" :disabled="busy || !code.trim()">
          <LoaderCircle v-if="busy" class="size-4 animate-spin" />
          {{ busy ? 'Kopple …' : 'Koppeln' }}
        </button>
      </form>

      <p class="px-2 text-center text-xs text-muted-foreground">
        Der Kopplungscode enthält den Schlüssel, mit dem deine Geräte ihre Daten verschlüsseln. Gib ihn nicht weiter.
      </p>
    </div>
  </div>
</template>
