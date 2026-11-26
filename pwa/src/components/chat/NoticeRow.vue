<script setup lang="ts">
import type { NoticeItem } from '../../shared/chat'

/** A note of Nexa or the CLI in the timeline: compacted, cleared, rewound, an error. */
defineProps<{ item: NoticeItem }>()

const TONES = { info: 'text-muted-foreground', warning: 'text-warning', error: 'text-destructive' } as const
</script>

<template>
  <div class="flex items-center gap-3 py-1 text-xs" :class="TONES[item.level]">
    <span class="h-px flex-1 bg-border" />
    <p class="max-w-[80%] text-center">
      {{ item.text }}<template v-if="item.rewind?.undone"> (rückgängig gemacht)</template>
      <span v-if="item.detail" class="block text-muted-foreground">{{ item.detail }}</span>
    </p>
    <span class="h-px flex-1 bg-border" />
  </div>
</template>
