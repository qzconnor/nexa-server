<script setup lang="ts">
import { nextTick, onBeforeUnmount, useTemplateRef, watch } from 'vue'

/**
 * A pane in the glass of the bars, as wide as the bar it comes from: up over the composer (the „+“ menu,
 * the chat's settings, its context), down under the header (the computers). One at a time; the page lets
 * what rests on the composer step aside meanwhile. Taps beside it close it and go nowhere else, as with
 * the app's menus; Esc goes back a page first (`back`), then closes it.
 */
const props = withDefaults(
  defineProps<{
    label: string
    /** Goes back from a page inside the pane; false when there is none to go back from. */
    back?: () => boolean
    side?: 'above' | 'below'
  }>(),
  { side: 'above' },
)
const open = defineModel<boolean>('open', { required: true })

const pane = useTemplateRef<HTMLElement>('pane')

// Esc anywhere while it is open: a tap in it (a page that changed under the finger) may leave the focus outside.
watch(
  open,
  (value) => {
    if (value) {
      document.addEventListener('keydown', onKeydown)
      void nextTick(() => pane.value?.focus())
    } else {
      document.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true },
)

function close(): void {
  open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (!props.back?.()) close()
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  close()
})
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40" aria-hidden="true" @click="close" />
  <Transition
    enter-active-class="transition duration-200 ease-out"
    :enter-from-class="side === 'above' ? 'translate-y-2 opacity-0' : '-translate-y-2 opacity-0'"
    leave-active-class="transition duration-150 ease-in"
    :leave-to-class="side === 'above' ? 'translate-y-2 opacity-0' : '-translate-y-2 opacity-0'"
  >
    <div v-if="open" class="absolute inset-x-0 z-50" :class="side === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'">
      <!-- The shadow on a wrapper: the pane's clip (bar-round) would cut it off. -->
      <div class="floating">
        <div
          ref="pane"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          tabindex="-1"
          class="floating-pane glass bar-round pane-edge flex max-h-[60dvh] flex-col border border-foreground/10 p-1.5 outline-none"
        >
          <slot />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* The glass of the bars, more frosted: what lies beneath (the chat, the composer) mustn't read through. */
.floating-pane {
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
}
</style>
