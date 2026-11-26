<script setup lang="ts">
import { Circle, CircleCheck, CircleDot } from '@lucide/vue'
import { computed } from 'vue'
import type { TodoItem } from '../../shared/chat'

/** The agent's todo list as it stands. */
const props = defineProps<{ item: TodoItem }>()

const done = computed(() => props.item.entries.filter((e) => e.status === 'completed').length)
</script>

<template>
  <div class="rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
    <p class="mb-1.5 text-xs font-medium text-muted-foreground">Aufgaben · {{ done }} von {{ item.entries.length }}</p>
    <ul class="space-y-1">
      <li v-for="(entry, i) in item.entries" :key="entry.id ?? i" class="flex items-start gap-2">
        <CircleCheck v-if="entry.status === 'completed'" class="mt-0.5 size-4 shrink-0 text-success" />
        <CircleDot v-else-if="entry.status === 'in_progress'" class="mt-0.5 size-4 shrink-0 text-primary" />
        <Circle v-else class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span :class="{ 'text-muted-foreground line-through': entry.status === 'completed' }">
          {{ entry.status === 'in_progress' && entry.activeText ? entry.activeText : entry.text }}
        </span>
      </li>
    </ul>
    <p v-if="item.explanation" class="mt-2 text-xs text-muted-foreground">{{ item.explanation }}</p>
  </div>
</template>
