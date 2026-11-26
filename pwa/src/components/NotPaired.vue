<script setup lang="ts">
import { Link2 } from '@lucide/vue'
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-4 shadow-lg shadow-black/5" aria-labelledby="not-paired">
    <div class="flex items-start gap-3">
      <div class="rounded-lg bg-primary/15 p-2 text-primary">
        <Link2 class="size-5" />
      </div>
      <div class="min-w-0 space-y-1">
        <h2 id="not-paired" class="font-semibold">Noch nicht gekoppelt</h2>
        <p class="text-sm text-muted-foreground">
          Mit einem Kopplungscode aus Nexa auf dem Computer (Einstellungen › Geräte › „Gerät hinzufügen“) steuerst du
          deine Computer von hier.
        </p>
      </div>
    </div>
    <RouterLink
      to="/pair"
      class="mt-4 flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
    >
      Koppeln
    </RouterLink>
  </section>
</template>
