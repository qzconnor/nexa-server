import { reactive, watch } from 'vue'
import { parseUnfold, type UnfoldSettings } from './components/chat/unfold'

const STORAGE_KEY = 'nexa.unfold'

/** What a chat's timeline opens by itself (Einstellungen › Chatverlauf); a choice per device, like the theme. */
export const unfoldSettings = reactive<UnfoldSettings>(read())

watch(unfoldSettings, (settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Private mode may refuse storage; the choice then lasts until the page closes.
  }
})

function read(): UnfoldSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return parseUnfold(stored ? JSON.parse(stored) : null)
  } catch {
    return parseUnfold(null)
  }
}
