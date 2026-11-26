<script setup lang="ts">
import { Monitor } from '@lucide/vue'
import NotPaired from '../components/NotPaired.vue'
</script>

<template>
  <div class="mx-auto max-w-xl space-y-6 p-4">
    <NotPaired />
    <section aria-labelledby="chats-computers">
      <h2
        id="chats-computers"
        class="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        <Monitor class="size-4" />
        Computer
      </h2>
      <p class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
        Gekoppelte Computer erscheinen hier, mit ihren Projekten und Chats.
      </p>
    </section>
  </div>
</template>
