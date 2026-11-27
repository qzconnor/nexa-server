<script setup lang="ts">
import { Check, ChevronDown, ChevronRight, CircleStop, LoaderCircle, RefreshCw, SquareTerminal, X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { host } from '../../host'
import { formatDuration } from '../../lib/format'
import { plainOutput, shellCommand, shellEnd, shellPurpose, shellStatus } from '../../lib/shells'
import type { ShellStatus, ToolItem } from '../../shared/chat'
import { IpcInvoke } from '../../shared/ipc'
import type { ShellOutput } from '../../shared/types'

/**
 * The shells at work in the background, above the composer as in the app's chat (ShellDock.vue): what
 * each is for, its command and how long it runs. A tap unfolds one with its command and the end of its
 * output, asked of the computer; stopping it takes the level „full“.
 */
const props = defineProps<{ shells: ToolItem[]; sessionId: string; now: number; full: boolean }>()
const folded = ref(false)
const openId = ref<string | null>(null)

const MAX_ROWS = 3
const showAll = ref(false)

const STATE: Record<ShellStatus, string> = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' }

const running = computed(() => props.shells.filter((s) => shellStatus(s) === 'running'))
const finished = computed(() => props.shells.length - running.value.length)
const rows = computed(() => {
  if (showAll.value || props.shells.length <= MAX_ROWS) return props.shells
  const first = (s: ToolItem) => shellStatus(s) === 'running' || s.id === openId.value
  return [...props.shells.filter(first), ...props.shells.filter((s) => !first(s))].slice(0, MAX_ROWS)
})
const more = computed(() => props.shells.length - rows.value.length)
const elapsed = (s: ToolItem) => formatDuration(Math.max(0, (shellEnd(s) ?? props.now) - s.startedAt))

// --- The unfolded one: its output, from the computer --------------------------------------------------

const output = ref<ShellOutput | null>(null)
const loading = ref(false)
const failed = ref<string | null>(null)
const stopping = ref(false)

async function readOutput(): Promise<void> {
  const id = openId.value
  if (!id) return
  loading.value = true
  failed.value = null
  try {
    const answer = (await host.call(IpcInvoke.sessionsShellOutput, [props.sessionId, id])) as ShellOutput | null
    if (openId.value === id) output.value = answer
  } catch (e) {
    if (openId.value === id) failed.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(openId, (id) => {
  output.value = null
  failed.value = null
  if (id) void readOutput()
})
// The output of a shell that ends: once more, so its last lines show.
watch(
  () => props.shells.find((s) => s.id === openId.value)?.shell?.status,
  (status, before) => {
    if (before === 'running' && status && status !== 'running') void readOutput()
  },
)

async function stop(shell: ToolItem): Promise<void> {
  stopping.value = true
  failed.value = null
  try {
    await host.call(IpcInvoke.sessionsStopShell, [props.sessionId, shell.id])
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e)
  } finally {
    stopping.value = false
  }
}

const text = computed(() => (output.value?.text ? plainOutput(output.value.text).trimEnd() : ''))
</script>

<template>
  <div class="glass card-round pane-edge flex flex-col border border-foreground/10 p-1.5">
    <div class="flex h-8 items-center gap-2 pr-0.5 pl-2 text-[0.82rem]">
      <SquareTerminal class="size-4 shrink-0 text-(--tool-run)" />
      <span class="font-medium">Shells</span>
      <span class="truncate text-muted-foreground tabular-nums">
        {{ running.length }} aktiv<template v-if="finished"> · {{ finished }} beendet</template>
      </span>
      <span v-if="folded && running[0]" class="min-w-0 flex-1 truncate font-mono text-[0.74rem] text-muted-foreground">{{ shellCommand(running[0]) }}</span>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        :class="{ 'ml-auto': !folded || !running[0] }"
        :aria-label="folded ? 'Shells ausklappen' : 'Shells einklappen'"
        :aria-expanded="!folded"
        @click="folded = !folded"
      >
        <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': folded }" />
      </button>
    </div>
    <div v-if="!folded" class="flex flex-col">
      <template v-for="s in rows" :key="s.id">
        <button
          type="button"
          class="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-foreground/5"
          :class="{ 'bg-foreground/5': openId === s.id }"
          :aria-label="`${shellPurpose(s) ?? shellCommand(s)}: ${STATE[shellStatus(s)]}`"
          :aria-expanded="openId === s.id"
          @click="openId = openId === s.id ? null : s.id"
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <LoaderCircle v-if="shellStatus(s) === 'running'" class="size-3.5 animate-spin text-(--tool-run)" />
            <Check v-else-if="shellStatus(s) === 'done'" class="size-3.5 text-success" />
            <X v-else-if="shellStatus(s) === 'error'" class="size-3.5 text-destructive" />
            <CircleStop v-else class="size-3.5 text-muted-foreground" />
          </span>
          <!-- A phone is narrow: what it is for, else the command. -->
          <span
            class="min-w-0 flex-1 truncate"
            :class="[shellPurpose(s) ? 'text-[0.84rem] font-medium' : 'font-mono text-[0.76rem]', { 'text-muted-foreground': shellStatus(s) !== 'running' && openId !== s.id }]"
          >
            {{ shellPurpose(s) ?? shellCommand(s) }}
          </span>
          <span class="shrink-0 text-[0.74rem] text-muted-foreground tabular-nums" :class="{ 'text-destructive': shellStatus(s) === 'error' }">
            <template v-if="shellStatus(s) !== 'running'">{{ STATE[shellStatus(s)] }} · </template>{{ elapsed(s) }}
          </span>
          <ChevronRight class="size-3.5 shrink-0 text-muted-foreground transition-transform" :class="{ 'rotate-90': openId === s.id }" />
        </button>
        <div v-if="openId === s.id" class="mx-1 mt-0.5 mb-1.5 space-y-2">
          <pre class="code-block max-h-16 whitespace-pre-wrap">{{ shellCommand(s) }}</pre>
          <pre v-if="text" class="code-block max-h-48">{{ text }}</pre>
          <p v-else-if="loading" class="flex items-center gap-2 px-1 text-xs text-muted-foreground"><LoaderCircle class="size-3.5 animate-spin" /> Holt die Ausgabe …</p>
          <p v-else-if="!failed" class="px-1 text-xs text-muted-foreground">Noch keine Ausgabe.</p>
          <p v-if="failed" class="px-1 text-xs text-destructive" role="alert">{{ failed }}</p>
          <p v-if="output?.truncated" class="px-1 text-xs text-muted-foreground">Nur das Ende der Ausgabe.</p>
          <div class="flex items-center gap-2">
            <button type="button" class="btn btn-outline h-8" :disabled="loading" @click="readOutput">
              <RefreshCw class="size-3.5" :class="{ 'animate-spin': loading }" />
              Aktualisieren
            </button>
            <button v-if="full && shellStatus(s) === 'running'" type="button" class="btn btn-outline h-8 text-destructive" :disabled="stopping" @click="stop(s)">
              <LoaderCircle v-if="stopping" class="size-3.5 animate-spin" />
              <CircleStop v-else class="size-3.5" />
              Stoppen
            </button>
          </div>
        </div>
      </template>
      <button
        v-if="more || (showAll && shells.length > MAX_ROWS)"
        type="button"
        class="flex h-8 items-center rounded-lg px-2 text-left text-[0.8rem] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger zeigen' : `+ ${more} weitere` }}
      </button>
    </div>
  </div>
</template>
