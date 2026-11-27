<script setup lang="ts">
/**
 * A switch for a yes or no, as the app's (ui/switch) and the ones of the „+“ menu. A checkbox beneath it
 * (role="switch") keeps it reachable by keyboard and labels.
 */
defineProps<{ id?: string; disabled?: boolean }>()
const on = defineModel<boolean>({ required: true })
</script>

<template>
  <span class="relative inline-flex h-5 w-9 shrink-0">
    <input :id="id" v-model="on" type="checkbox" role="switch" class="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-default" :disabled="disabled" />
    <span
      aria-hidden="true"
      class="pointer-events-none flex size-full items-center rounded-full bg-foreground/20 p-0.5 transition-colors peer-checked:bg-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:opacity-50"
    >
      <span class="size-4 rounded-full bg-white shadow-sm transition-transform" :class="on ? 'translate-x-4' : 'translate-x-0'" />
    </span>
  </span>
</template>
