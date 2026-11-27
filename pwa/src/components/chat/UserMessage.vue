<script setup lang="ts">
import { ChevronDown, Image, MessageSquareShare } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import type { UserItem } from '../../shared/chat'
import MarkdownText from './MarkdownText.vue'

/**
 * A prompt: the user's, or one another chat's agent sent (`from`). In Markdown with each line break as
 * typed, like the app's. Queued: sent, not taken up yet. A long one shows its beginning, fading out
 * above „Mehr anzeigen“: on a phone it would push all that came after it off the screen.
 */
defineProps<{ item: UserItem; queued?: boolean }>()

/**
 * Folded from this height (rem) on, to `max-h-64` (16rem): only when that hides a few lines at least,
 * else the tap would cost more than the lines.
 */
const FOLD_FROM_REM = 22

const body = useTemplateRef<HTMLElement>('body')
const long = ref(false)
const expanded = ref(false)
const folded = computed(() => long.value && !expanded.value)

/** The text's full height, unclipped: it changes with the width of the screen and the text's fonts loading. */
function measure(): void {
  const el = body.value
  if (!el) return
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  long.value = el.offsetHeight > FOLD_FROM_REM * rem
}

let observer: ResizeObserver | null = null
onMounted(() => {
  if (!body.value) return
  observer = new ResizeObserver(measure)
  observer.observe(body.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="flex flex-col items-end gap-1" :class="{ 'opacity-60': queued }">
    <p v-if="item.from" class="flex items-center gap-1 px-1 text-xs text-muted-foreground">
      <MessageSquareShare class="size-3.5" />
      Von „{{ item.from.title }}“<template v-if="item.from.device"> auf {{ item.from.device.name }}</template>
    </p>
    <div class="max-w-[85%] min-w-0 rounded-2xl rounded-br-md border border-border bg-secondary px-3.5 py-2">
      <!-- Clipped only while folded; the text inside keeps its full height, which is what is measured. -->
      <div v-if="item.text" :class="folded && 'fade-end max-h-64 overflow-hidden'">
        <div ref="body">
          <MarkdownText :text="item.text" breaks class="text-[0.95rem]" />
        </div>
      </div>
      <button
        v-if="long"
        type="button"
        class="-mx-1 mt-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <ChevronDown class="size-3.5 transition-transform" :class="{ 'rotate-180': expanded }" />
        {{ expanded ? 'Weniger anzeigen' : 'Mehr anzeigen' }}
      </button>
      <p v-if="item.images?.length" class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Image class="size-3.5" />
        {{ item.images.length === 1 ? '1 Bild' : `${item.images.length} Bilder` }}
      </p>
    </div>
    <p v-if="queued" class="px-1 text-xs text-muted-foreground">Wartet, bis der Agent es aufnimmt</p>
    <p v-else-if="item.steer" class="px-1 text-xs text-muted-foreground">Während der Arbeit gesendet</p>
  </div>
</template>
