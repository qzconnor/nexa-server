<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '../../lib/markdown'

/** Markdown of an answer (raw HTML off, so it is safe for v-html); while it streams, a caret at its end. */
const props = defineProps<{ text: string; streaming?: boolean; breaks?: boolean }>()

/**
 * While the text streams it is parsed at most this often: each parse takes the whole text, so
 * rendering every piece grew with the square of a long answer's length (as in the app's Markdown.vue).
 */
const STREAM_RENDER_MS = 120
const shown = ref(props.text)
let renderedAt = 0
let timer: ReturnType<typeof setTimeout> | undefined

function catchUp(): void {
  clearTimeout(timer)
  timer = undefined
  renderedAt = performance.now()
  shown.value = props.text
}

watch(
  () => props.text,
  () => {
    if (!props.streaming) return catchUp()
    if (timer) return
    const wait = STREAM_RENDER_MS - (performance.now() - renderedAt)
    if (wait <= 0) catchUp()
    else timer = setTimeout(catchUp, wait)
  },
)
watch(
  () => props.streaming,
  () => catchUp(),
)
onBeforeUnmount(() => clearTimeout(timer))

const html = computed(() => renderMarkdown(shown.value, props.breaks))
</script>

<template>
  <div class="markdown" :class="{ streaming }" v-html="html" />
</template>
