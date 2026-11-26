import { createApp } from 'vue'
import App from './App.vue'
import './main.css'
import { router } from './router'
import { startTheme } from './theme'

startTheme()
createApp(App).use(router).mount('#app')
