<script setup lang="ts">
import { computed } from 'vue'
import { duration } from '../../format'
import type { TurnItem } from '../../shared/chat'

/** The end of a turn: how long it took, what it changed, or why it stopped. */
const props = defineProps<{ item: TurnItem }>()

const parts = computed(() => {
  const list: string[] = []
  if (props.item.durationMs !== undefined) list.push(duration(props.item.durationMs))
  const changes = props.item.fileChanges
  if (changes?.files) list.push(`${changes.files === 1 ? '1 Datei' : `${changes.files} Dateien`} +${changes.insertions} −${changes.deletions}`)
  return list
})
</script>

<template>
  <div class="px-1 text-xs">
    <p v-if="item.status === 'error'" class="text-destructive">
      {{ item.limit ? 'Am Limit des Kontos angehalten.' : 'Fehlgeschlagen.' }}
      <span v-if="item.error" class="break-words">{{ item.error }}</span>
    </p>
    <p v-else-if="item.status === 'interrupted'" class="text-muted-foreground">Abgebrochen<template v-if="parts.length"> · {{ parts.join(' · ') }}</template></p>
    <p v-else-if="parts.length" class="text-muted-foreground">{{ parts.join(' · ') }}</p>
  </div>
</template>
