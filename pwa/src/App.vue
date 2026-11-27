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
  { id: 'settings', to: '/settings', label: 'Einstellungen', icon: Settings },
] as const

const title = computed(() => pageTitle.value?.text ?? route.meta.title)

function back(): void {
  // Opened directly (a link, the home screen): the page above it, not out of the app. A page right
  // below the root (/pair) goes to its tab.
  if (window.history.state?.back) router.back()
  else void router.replace(route.path.split('/').slice(0, -1).join('/') || tabs.find((t) => t.id === route.meta.tab)?.to || '/')
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
      </div>
    </header>

    <!-- A chat scrolls itself, between the header and its composer. -->
    <main v-if="route.meta.fullscreen" class="h-full">
      <RouterView />
    </main>
    <main v-else class="pt-header pb-tabbar px-safe h-full overflow-y-auto overscroll-contain">
      <RouterView />
    </main>

    <!--
      A dock like the app's composer, as wide as the pages' cards (p-4 in max-w-xl); the page shows around
      and through it. The active tab sits on a pane of its own, rounded like the dock less its padding.
    -->
    <nav v-if="!route.meta.fullscreen" class="bottom-dock px-safe pointer-events-none absolute inset-x-0 z-10" aria-label="Bereiche">
      <div
        class="glass floating pointer-events-auto mx-4 grid h-(--tabbar-height) grid-cols-3 gap-1 rounded-[1.375rem] border border-foreground/10 p-1.5 sm:mx-auto sm:max-w-[34rem]"
      >
        <RouterLink
          v-for="tab in tabs"
          :key="tab.id"
          :to="tab.to"
          class="flex flex-col items-center justify-center gap-0.5 rounded-[1rem] border text-[11px] font-medium transition-colors duration-200"
          :class="
            route.meta.tab === tab.id
              ? 'border-foreground/10 bg-foreground/10 text-foreground shadow-sm'
              : 'border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
          "
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
