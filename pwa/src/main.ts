import { createApp } from 'vue'
import App from './App.vue'
import { startLink, takePairingCodeFromUrl } from './link'
import './main.css'
import { router } from './router'
import { startTheme } from './theme'

startTheme()
const code = takePairingCodeFromUrl()
startLink()
const app = createApp(App).use(router)
if (code) void router.replace('/pair')
app.mount('#app')
