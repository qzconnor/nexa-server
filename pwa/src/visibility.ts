import { ref } from 'vue'

/** The page is in front: on a phone the app on screen, not in the background or locked. */
export const pageVisible = ref(document.visibilityState === 'visible')

document.addEventListener('visibilitychange', () => {
  pageVisible.value = document.visibilityState === 'visible'
})
