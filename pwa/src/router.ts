import { createRouter, createWebHistory } from 'vue-router'
import ChatsView from './views/ChatsView.vue'
import ChatView from './views/ChatView.vue'
import HostView from './views/HostView.vue'
import InboxView from './views/InboxView.vue'
import PairView from './views/PairView.vue'
import SettingsView from './views/SettingsView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
    /** The tab of the bottom bar the page belongs to. */
    tab?: 'inbox' | 'chats' | 'settings'
    /** A page under another one: a back button instead of the settings. */
    back?: boolean
    /** The page takes the whole height below the header, without the bar (a chat with its composer). */
    fullscreen?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'inbox', component: InboxView, meta: { title: 'Inbox', tab: 'inbox' } },
    { path: '/chats', name: 'chats', component: ChatsView, meta: { title: 'Chats', tab: 'chats' } },
    { path: '/chats/:host', name: 'host', component: HostView, props: true, meta: { title: 'Computer', tab: 'chats', back: true } },
    {
      path: '/chats/:host/:chat',
      name: 'chat',
      component: ChatView,
      props: true,
      meta: { title: 'Chat', tab: 'chats', back: true, fullscreen: true },
    },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { title: 'Einstellungen', tab: 'settings' } },
    { path: '/pair', name: 'pair', component: PairView, meta: { title: 'Koppeln', tab: 'settings', back: true } },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
})
