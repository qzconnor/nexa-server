<script setup lang="ts">
import { KeyRound, LoaderCircle } from '@lucide/vue'
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { link } from '../client'
import { guessDeviceName } from '../device-name'
import { linkState, pendingPairingCode } from '../link'
import { decodePairingCode } from '../shared/nexa-server/pairing-code'

const router = useRouter()
// From a QR code's link; taken once, so it doesn't linger in memory after this page.
const fromLink = pendingPairingCode.value !== null
const code = ref(pendingPairingCode.value ?? '')
pendingPairingCode.value = null
const name = ref(guessDeviceName())
const busy = ref(false)
const error = ref<string | null>(null)

const decoded = computed(() => decodePairingCode(code.value.trim()))
const paired = computed(() => linkState.value.status !== 'unpaired' && linkState.value.status !== 'loading')

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
  <div class="mx-auto max-w-xl space-y-6 p-4">
    <section v-if="paired" class="rounded-xl border border-border bg-card p-4 text-sm">
      Dieses Gerät ist schon gekoppelt. Abmelden kannst du es unter
      <RouterLink to="/settings" class="text-primary underline-offset-4 hover:underline">Einstellungen</RouterLink>.
    </section>

    <form v-else class="space-y-5" @submit.prevent="pair">
      <div class="flex items-start gap-3 px-1">
        <div class="rounded-lg bg-primary/15 p-2 text-primary">
          <KeyRound class="size-5" />
        </div>
        <p class="text-sm text-muted-foreground">
          Öffne Nexa auf einem gekoppelten Computer, dort Einstellungen › Geräte › „Gerät hinzufügen“. Den
          Kopplungscode fügst du hier ein; er gilt einmal und 15 Minuten.
        </p>
      </div>

      <label class="block space-y-1.5">
        <span class="px-1 text-sm font-medium">Kopplungscode</span>
        <textarea
          v-model="code"
          rows="4"
          required
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="nexa1:…"
          class="w-full resize-none rounded-lg border border-input bg-card px-3 py-2 font-mono text-xs break-all outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <span v-if="fromLink && decoded" class="block px-1 text-xs text-muted-foreground">Aus dem Link übernommen.</span>
        <span v-if="decoded" class="block px-1 text-xs text-muted-foreground">Server: {{ decoded.url }}</span>
      </label>

      <label class="block space-y-1.5">
        <span class="px-1 text-sm font-medium">Name dieses Geräts</span>
        <input
          v-model="name"
          required
          maxlength="64"
          autocomplete="off"
          class="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        <span class="block px-1 text-xs text-muted-foreground">So steht es auf den anderen Geräten in der Liste.</span>
      </label>

      <p v-if="error" role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {{ error }}
      </p>

      <button
        type="submit"
        :disabled="busy || !code.trim()"
        class="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
      >
        <LoaderCircle v-if="busy" class="size-4 animate-spin" />
        {{ busy ? 'Kopple …' : 'Koppeln' }}
      </button>
    </form>
  </div>
</template>
