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
  <Transition name="pane">
    <div v-if="open" class="absolute inset-x-0 z-50" :class="side === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'" :data-side="side">
      <!-- The shadow beside the pane, not around it: the pane's clip (bar-round) would cut it off, and a fading wrapper would take its blur. -->
      <div class="pane-fade floating absolute inset-0" aria-hidden="true" />
      <div
        ref="pane"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        class="pane-fade floating-pane glass bar-round pane-edge relative flex max-h-[60dvh] flex-col border border-foreground/10 p-1.5 outline-none"
      >
        <div class="pane-content flex min-h-0 flex-col">
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

/*
 * The wrapper only moves; the pane and its shadow fade themselves. Faded on the wrapper, the pane would
 * lose its blur until the end (an ancestor with opacity below 1 leaves backdrop-filter nothing to blur)
 * and its text would float over the sharp chat for a moment.
 */
.pane-enter-active,
.pane-enter-active .pane-fade {
  transition-duration: 200ms;
  transition-timing-function: ease-out;
}
.pane-leave-active,
.pane-leave-active .pane-fade {
  transition-duration: 150ms;
  transition-timing-function: ease-in;
}
.pane-enter-active,
.pane-leave-active {
  transition-property: translate;
}
.pane-enter-active .pane-fade,
.pane-leave-active .pane-fade {
  transition-property: opacity;
}
.pane-enter-from[data-side='above'],
.pane-leave-to[data-side='above'] {
  translate: 0 0.5rem;
}
.pane-enter-from[data-side='below'],
.pane-leave-to[data-side='below'] {
  translate: 0 -0.5rem;
}
.pane-enter-from .pane-fade,
.pane-leave-to .pane-fade {
  opacity: 0;
}
/* What it holds comes a moment after the glass and goes a moment before it: no text without its pane. */
.pane-enter-active .pane-content {
  transition: opacity 150ms ease-out 50ms;
}
.pane-leave-active .pane-content {
  transition: opacity 100ms ease-in;
}
.pane-enter-from .pane-content,
.pane-leave-to .pane-content {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .pane-enter-from,
  .pane-leave-to {
    translate: none !important;
  }
}
</style>
