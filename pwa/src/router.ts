import { createRouter, createWebHistory } from 'vue-router'
import { chooseComputer } from './computers'
import ChatsView from './views/ChatsView.vue'
import ChatView from './views/ChatView.vue'
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
    // A computer's own page is the chats tab with it picked: a link to it, or the way back from a chat opened directly.
    {
      path: '/chats/:host',
      redirect: (to) => {
        chooseComputer(String(to.params.host))
        // By path: a named target would get the `host` param it doesn't have (vue-router warns).
        return { path: '/chats' }
      },
    },
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
