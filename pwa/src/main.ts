import { createApp } from 'vue'
import App from './App.vue'
import { startLink, takePairingCodeFromUrl } from './link'
import './main.css'
import { startPush } from './push/subscription'
import { router } from './router'
import { startTheme } from './theme'

startTheme()
const code = takePairingCodeFromUrl()
// Before the link starts: it follows the link's first login.
startPush(router)
startLink()
const app = createApp(App).use(router)
if (code) void router.replace('/setup')
// After the first navigation: until then it waits for the pairing (router.ts), and a page shown before
// would flash the tabs at a device that has none.
void router.isReady().then(() => app.mount('#app'))
