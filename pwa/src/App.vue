<script setup lang="ts">
import { ChevronDown, ChevronLeft, Inbox, LoaderCircle, MessagesSquare, Settings } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import ComputerMenu from './components/ComputerMenu.vue'
import UsageRing from './components/UsageRing.vue'
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
const computer = computed(() => pageTitle.value?.computer)
/** The menu of the computers under the header, where the page lets one pick another. */
const computerMenu = ref(false)
watch(
  () => [route.fullPath, computer.value?.switchable],
  () => (computerMenu.value = false),
)
const limits = computed(() => pageTitle.value?.limits)
/** The limits in words, for a long press and screen readers: „5-Stunden-Fenster 42 %, Woche 12 %“. */
const limitsText = computed(() =>
  limits.value ? `${limits.value.windows.map((w) => `${w.label} ${w.percent} %`).join(', ')}${limits.value.limited ? '; das Limit ist erreicht' : ''}` : '',
)
const activeTab = computed(() => tabs.findIndex((t) => t.id === route.meta.tab))

function back(): void {
  // Opened directly (a link, the home screen): the page above it, not out of the app. A page right
  // below the root (/pair) goes to its tab.
  if (window.history.state?.back) router.back()
  else void router.replace(route.path.split('/').slice(0, -1).join('/') || tabs.find((t) => t.id === route.meta.tab)?.to || '/')
}
</script>

<template>
  <div class="relative h-full">
    <!-- Header and dock float over the page (absolute), so it scrolls beneath their glass; the header is the dock's twin. -->
    <header class="top-dock px-safe pointer-events-none absolute inset-x-0 z-20">
      <!-- The bar and what drops from it: the menu outside the bar, whose clip (bar-round) would cut it off. -->
      <div class="pointer-events-auto relative mx-4 sm:mx-auto sm:max-w-[34rem]">
        <div class="glass bar-round pane-edge flex h-(--header-height) items-center gap-1 border border-foreground/10 px-1.5">
          <button
            v-if="route.meta.back"
            type="button"
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label="Zurück"
            @click="back"
          >
            <ChevronLeft class="size-5" />
          </button>
          <h1 class="min-w-0 flex-1 truncate px-2.5 text-base font-semibold">{{ title }}</h1>
          <!-- The computer whose chats these are, with its dot, instead of a card of its own above them; with others, a menu of them. -->
          <component
            :is="computer.switchable ? 'button' : 'span'"
            v-if="computer"
            :type="computer.switchable ? 'button' : undefined"
            class="mr-0.5 flex h-8 max-w-[55%] min-w-0 items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-3 text-sm"
            :class="computer.switchable && 'pr-2 transition-colors hover:bg-foreground/10 active:bg-foreground/15'"
            :title="computer.hint"
            :aria-haspopup="computer.switchable ? 'dialog' : undefined"
            :aria-expanded="computer.switchable ? computerMenu : undefined"
            @click="computer.switchable && (computerMenu = !computerMenu)"
          >
            <LoaderCircle v-if="computer.busy" class="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
            <span v-else class="size-2 shrink-0 rounded-full" :class="computer.dot" aria-hidden="true" />
            <span class="truncate">{{ computer.name }}</span>
            <span v-if="computer.hint" class="sr-only">, {{ computer.hint }}</span>
            <ChevronDown
              v-if="computer.switchable"
              class="size-4 shrink-0 text-muted-foreground transition-transform"
              :class="computerMenu && 'rotate-180'"
              aria-hidden="true"
            />
          </component>
          <!-- A chat's plan limits, as in the app's title bar: a ring, the window and how full it is. -->
          <span v-if="limits?.windows.length" class="mr-2 flex shrink-0 items-center gap-2.5 text-xs" :title="limitsText">
            <span v-for="w in limits.windows" :key="w.key" class="flex items-center gap-1" aria-hidden="true">
              <UsageRing :percent="w.percent" />
              <span class="text-muted-foreground">{{ w.short }}</span>
              <span class="font-medium tabular-nums" :class="w.percent >= 85 || limits.limited ? 'text-destructive' : 'text-foreground'">{{ w.percent }}&nbsp;%</span>
            </span>
            <span class="sr-only">Limits: {{ limitsText }}</span>
          </span>
        </div>
        <ComputerMenu v-if="computer?.switchable" v-model:open="computerMenu" />
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
      <div class="floating pointer-events-auto mx-4 sm:mx-auto sm:max-w-[34rem]">
        <div class="glass bar-round pane-edge relative grid h-(--tabbar-height) grid-cols-3 gap-1 border border-foreground/10 p-1.5">
          <!--
            One pane for all tabs that slides to the active one, rather than a pane per tab that jumps. A
            column wide (the dock less its padding and gaps); a column and a gap per step.
          -->
          <span
            aria-hidden="true"
            class="absolute inset-y-1.5 left-1.5 w-[calc((100%_-_1.25rem)/3)] rounded-[1rem] border border-foreground/10 bg-foreground/10 shadow-sm transition-[translate,opacity] duration-[400ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
            :class="activeTab < 0 && 'opacity-0'"
            :style="{ translate: `calc(${Math.max(activeTab, 0)} * (100% + 0.25rem)) 0` }"
          />
          <RouterLink
            v-for="tab in tabs"
            :key="tab.id"
            :to="tab.to"
            class="relative flex flex-col items-center justify-center gap-0.5 rounded-[1rem] text-[11px] font-medium transition-colors duration-300"
            :class="route.meta.tab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'"
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
      </div>
    </nav>
  </div>
</template>
