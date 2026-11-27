import { watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { chooseComputer } from './computers'
import { isPaired, linkState, pendingPairingCode, whenLinkKnown } from './link'
import ChatsView from './views/ChatsView.vue'
import ChatView from './views/ChatView.vue'
import InboxView from './views/InboxView.vue'
import SettingsView from './views/SettingsView.vue'
import SetupView from './views/SetupView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
    /** The tab of the bottom bar the page belongs to. */
    tab?: 'inbox' | 'chats' | 'settings'
    /** A page under another one: a back button instead of the settings. */
    back?: boolean
    /** The page takes the whole height below the header, without the bar (a chat with its composer). */
    fullscreen?: boolean
    /** A page on its own, without header and dock: setting this device up, before anything else is there. */
    setup?: boolean
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
    { path: '/setup', name: 'setup', component: SetupView, meta: { title: 'Einrichten', setup: true } },
    // The setup page's old address, from bookmarks and links of earlier versions.
    { path: '/pair', redirect: '/setup' },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
})

/**
 * Unpaired, there is only the setup page: every other address leads there, and nothing of the rest shows
 * (no tabs, no empty lists). Paired, the setup page leads home. Before the browser's storage is read
 * nobody knows which, so the first navigation waits for it.
 */
router.beforeEach(async (to) => {
  const paired = isPaired(await whenLinkKnown())
  if (!paired && to.name !== 'setup') return { name: 'setup' }
  if (paired && to.name === 'setup') {
    // A code from a link has no use here: it holds the namespace's key, so it goes rather than lingers.
    pendingPairingCode.value = null
    return { path: '/' }
  }
  return true
})

// Unpaired while in use (signed out here, or this device removed elsewhere): back to the setup page at once.
watch(
  () => linkState.value.status,
  (status) => {
    if (status === 'unpaired' && router.currentRoute.value.name !== 'setup') void router.replace({ name: 'setup' })
  },
)
