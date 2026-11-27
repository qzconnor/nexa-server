<script setup lang="ts">
import { ChevronLeft, Inbox, MessagesSquare, Settings } from '@lucide/vue'
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { inbox } from './inbox'
import { pageTitle } from './page-title'

const route = useRoute()
const router = useRouter()
/** Questions to answer and chats that broke, on every computer: on the tab, from any page. */
const attention = inbox.attention

const tabs = [
  { id: 'inbox', to: '/', label: 'Inbox', icon: Inbox },
  { id: 'chats', to: '/chats', label: 'Chats', icon: MessagesSquare },
] as const

const title = computed(() => pageTitle.value?.text ?? route.meta.title)

function back(): void {
  // Opened directly (a link, the home screen): the page above it, not out of the app.
  if (window.history.state?.back) router.back()
  else void router.replace(route.path.split('/').slice(0, -1).join('/') || '/')
}
</script>

<template>
  <div class="relative h-full">
    <!-- Header and bar float over the page (absolute), so it scrolls beneath their glass. -->
    <header class="glass pt-safe px-safe absolute inset-x-0 top-0 z-10 border-b border-border">
      <div class="mx-auto flex h-(--header-height) max-w-xl items-center gap-1 px-2">
        <button
          v-if="route.meta.back"
          type="button"
          class="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Zurück"
          @click="back"
        >
          <ChevronLeft class="size-5" />
        </button>
        <h1 class="min-w-0 flex-1 truncate px-2 text-base font-semibold">{{ title }}</h1>
        <RouterLink
          v-if="!route.meta.back"
          to="/settings"
          class="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Einstellungen"
        >
          <Settings class="size-5" />
        </RouterLink>
      </div>
    </header>

    <!-- A chat scrolls itself, between the header and its composer. -->
    <main v-if="route.meta.fullscreen" class="h-full">
      <RouterView />
    </main>
    <main v-else class="pt-header pb-tabbar px-safe h-full overflow-y-auto overscroll-contain">
      <RouterView />
    </main>

    <nav
      v-if="!route.meta.fullscreen"
      class="glass pb-safe px-safe absolute inset-x-0 bottom-0 z-10 border-t border-border"
      aria-label="Bereiche"
    >
      <div class="mx-auto grid h-(--tabbar-height) max-w-xl grid-cols-2">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.id"
          :to="tab.to"
          class="flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors"
          :class="route.meta.tab === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          :aria-current="route.meta.tab === tab.id ? 'page' : undefined"
        >
          <span class="relative">
            <component :is="tab.icon" class="size-5" :stroke-width="route.meta.tab === tab.id ? 2.25 : 1.75" />
            <span
              v-if="tab.id === 'inbox' && attention"
              class="absolute -top-1.5 left-3 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
            >
              {{ attention > 99 ? '99+' : attention }}
            </span>
          </span>
          {{ tab.label }}
          <span v-if="tab.id === 'inbox' && attention" class="sr-only">, {{ attention }} brauchen dich</span>
        </RouterLink>
      </div>
    </nav>
  </div>
</template>
