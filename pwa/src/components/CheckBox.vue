<script setup lang="ts">
import { Check } from '@lucide/vue'

/**
 * A checkbox in the app's look (ui/checkbox): the browser's own stays a grey block on the dark themes.
 * The real input lies invisible over the box, so the keyboard, screen readers and a label around it work
 * as with any checkbox.
 */
defineProps<{ id?: string; disabled?: boolean }>()
const checked = defineModel<boolean>({ required: true })
</script>

<template>
  <span class="relative inline-flex size-4 shrink-0">
    <input :id="id" v-model="checked" type="checkbox" class="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-default" :disabled="disabled" />
    <span
      aria-hidden="true"
      class="pointer-events-none flex size-full items-center justify-center rounded-[4px] border border-foreground/25 bg-foreground/[0.05] text-primary-foreground transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:opacity-50"
    >
      <Check v-if="checked" class="size-3.5" :stroke-width="3" />
    </span>
  </span>
</template>
