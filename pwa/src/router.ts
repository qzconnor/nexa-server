import { createRouter, createWebHistory } from 'vue-router'
import ChatsView from './views/ChatsView.vue'
import InboxView from './views/InboxView.vue'
import PairView from './views/PairView.vue'
import SettingsView from './views/SettingsView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
    /** The tab of the bottom bar the page belongs to; pages without one get a back button. */
    tab?: 'inbox' | 'chats'
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'inbox', component: InboxView, meta: { title: 'Inbox', tab: 'inbox' } },
    { path: '/chats', name: 'chats', component: ChatsView, meta: { title: 'Chats', tab: 'chats' } },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Einstellungen' } },
    { path: '/pair', name: 'pair', component: PairView, meta: { title: 'Koppeln' } },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
})
