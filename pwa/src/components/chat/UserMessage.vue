<script setup lang="ts">
import { Image, MessageSquareShare } from '@lucide/vue'
import type { UserItem } from '../../shared/chat'

/** A prompt: the user's, or one another chat's agent sent (`from`). Queued: sent, not taken up yet. */
defineProps<{ item: UserItem; queued?: boolean }>()
</script>

<template>
  <div class="flex flex-col items-end gap-1" :class="{ 'opacity-60': queued }">
    <p v-if="item.from" class="flex items-center gap-1 px-1 text-xs text-muted-foreground">
      <MessageSquareShare class="size-3.5" />
      Von „{{ item.from.title }}“<template v-if="item.from.device"> auf {{ item.from.device.name }}</template>
    </p>
    <div class="max-w-[85%] rounded-2xl rounded-br-md border border-border bg-secondary px-3.5 py-2">
      <p class="text-[0.95rem] break-words whitespace-pre-wrap">{{ item.text }}</p>
      <p v-if="item.images?.length" class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Image class="size-3.5" />
        {{ item.images.length === 1 ? '1 Bild' : `${item.images.length} Bilder` }}
      </p>
    </div>
    <p v-if="queued" class="px-1 text-xs text-muted-foreground">Wartet, bis der Agent es aufnimmt</p>
    <p v-else-if="item.steer" class="px-1 text-xs text-muted-foreground">Während der Arbeit gesendet</p>
  </div>
</template>
