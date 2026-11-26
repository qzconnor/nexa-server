<script lang="ts">
/** What was typed and not sent, per chat, while the page lives: leaving a chat for a moment keeps it. */
const drafts = new Map<string, string>()
</script>

<script setup lang="ts">
import { ArrowUp, LoaderCircle, Square } from '@lucide/vue'
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

/**
 * Writes a prompt for the chat. Enter sends where there is a keyboard (Shift+Enter: a new line); on a
 * phone Enter is a new line and the button sends, as in its messengers. `running`: the agent is at work,
 * so a prompt joins its turn and Stop interrupts it.
 */
const props = defineProps<{
  draftKey: string
  placeholder: string
  running: boolean
  disabled?: boolean
  send: (text: string) => Promise<void>
  stop: () => Promise<void>
}>()

const text = ref(drafts.get(props.draftKey) ?? '')
const sending = ref(false)
const stopping = ref(false)
const error = ref<string | null>(null)
const field = useTemplateRef<HTMLTextAreaElement>('field')
const coarse = window.matchMedia('(pointer: coarse)')

watch(
  () => props.draftKey,
  (key, before) => {
    if (before !== undefined) drafts.set(before, text.value)
    text.value = drafts.get(key) ?? ''
    error.value = null
  },
)
watch(text, (value) => {
  if (value) drafts.set(props.draftKey, value)
  else drafts.delete(props.draftKey)
  error.value = null
  void nextTick(fit)
})
onMounted(fit)

/** Grows with its text, up to a third of the screen. */
function fit(): void {
  const el = field.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, window.innerHeight / 3)}px`
}

async function submit(): Promise<void> {
  const prompt = text.value.trim()
  if (!prompt || sending.value || props.disabled) return
  sending.value = true
  error.value = null
  try {
    await props.send(prompt)
    text.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    sending.value = false
  }
}

async function interrupt(): Promise<void> {
  if (stopping.value) return
  stopping.value = true
  error.value = null
  try {
    await props.stop()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    stopping.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return
  if (event.shiftKey || (coarse.matches && !event.ctrlKey && !event.metaKey)) return
  event.preventDefault()
  void submit()
}
</script>

<template>
  <form class="space-y-1.5" @submit.prevent="submit">
    <div class="flex items-end gap-2 rounded-2xl border border-input bg-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/50">
      <textarea
        ref="field"
        v-model="text"
        rows="1"
        class="max-h-[33vh] min-h-9 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-base outline-none placeholder:text-muted-foreground"
        :placeholder="placeholder"
        :disabled="disabled"
        aria-label="Prompt"
        @keydown="onKeydown"
      />
      <button
        v-if="running"
        type="button"
        class="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground hover:bg-accent disabled:opacity-50"
        :disabled="stopping"
        aria-label="Abbrechen"
        title="Abbrechen"
        @click="interrupt"
      >
        <LoaderCircle v-if="stopping" class="size-4 animate-spin" />
        <Square v-else class="size-3.5 fill-current" />
      </button>
      <button
        type="submit"
        class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        :disabled="!text.trim() || sending || disabled"
        aria-label="Senden"
        title="Senden"
      >
        <LoaderCircle v-if="sending" class="size-4 animate-spin" />
        <ArrowUp v-else class="size-4" :stroke-width="2.5" />
      </button>
    </div>
    <p v-if="error" class="px-2 text-xs text-destructive" role="alert">{{ error }}</p>
  </form>
</template>
