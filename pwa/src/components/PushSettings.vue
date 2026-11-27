<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import { linkState } from '../link'
import { checkServerPush, disablePush, enablePush, pushState } from '../push/subscription'
import { REMOTE_LEVEL_LABELS } from '../shared/remote'

const paired = computed(() => linkState.value.status !== 'unpaired' && linkState.value.status !== 'loading')
const online = computed(() => linkState.value.status === 'online')

/** Why the switch can't be turned on now; null when it can. */
const blocked = computed((): string | null => {
  if (pushState.support === 'home-screen') {
    return 'Auf iPhone und iPad gehen Benachrichtigungen nur in der Web-App vom Home-Bildschirm: In Safari auf „Teilen“ › „Zum Home-Bildschirm“ tippen und Nexa von dort öffnen.'
  }
  if (pushState.support === 'no') return 'Dieser Browser kann keine Benachrichtigungen von Web-Apps empfangen.'
  if (pushState.server === false) return 'Dieser Server schickt keine Benachrichtigungen.'
  if (pushState.permission === 'denied') {
    return 'Benachrichtigungen sind für diese Seite blockiert. Erlaube sie in den Einstellungen des Browsers (auf dem iPhone: Einstellungen › Mitteilungen › Nexa).'
  }
  if (!paired.value) return 'Erst koppeln: Benachrichtigungen kommen von den Computern im Namespace.'
  if (!online.value) return 'Zum Einschalten braucht es die Verbindung zum Server.'
  return null
})

// Off goes always: the browser drops its subscription even without the server.
const disabled = computed(() => pushState.busy || (!pushState.on && blocked.value !== null))

function toggle(): void {
  if (pushState.on) void disablePush()
  else void enablePush()
}

onMounted(() => {
  // Ahead of the tap: Safari wants the subscription close to it, not after a round trip.
  if (pushState.support === 'yes') void checkServerPush()
})
</script>

<template>
  <section aria-labelledby="settings-push" class="space-y-2">
    <div class="px-1">
      <h2 id="settings-push" class="font-semibold">Benachrichtigungen</h2>
      <p class="text-sm text-muted-foreground">
        Die Computer melden sich auf diesem Gerät, wenn ein Chat fertig ist, eine Frage hat oder an ein Limit stößt, auch wenn
        Nexa hier geschlossen ist.
      </p>
    </div>

    <div class="rounded-xl border border-border bg-card text-sm">
      <div class="flex items-center justify-between gap-4 px-4 py-3">
        <span id="push-label">Auf diesem Gerät</span>
        <div class="flex items-center gap-2">
          <LoaderCircle v-if="pushState.busy" class="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          <button
            type="button"
            role="switch"
            aria-labelledby="push-label"
            :aria-checked="pushState.on"
            :disabled="disabled"
            class="relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50"
            :class="pushState.on ? 'bg-primary' : 'bg-muted-foreground/30'"
            @click="toggle"
          >
            <span
              class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform"
              :class="pushState.on ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
      </div>
      <p v-if="pushState.error" class="border-t border-border px-4 py-3 text-destructive" role="alert">{{ pushState.error }}</p>
      <p v-else-if="blocked && !pushState.on" class="border-t border-border px-4 py-3 text-muted-foreground">{{ blocked }}</p>
    </div>

    <p class="px-1 text-sm text-muted-foreground">
      Was kommt, stellt jeder Computer ein: in Nexa unter Einstellungen › Benachrichtigungen › „Aufs Handy schicken“. Es
      kommt nur von Computern, die diesem Gerät mindestens „{{ REMOTE_LEVEL_LABELS.read }}“ erlauben.
    </p>
  </section>
</template>
