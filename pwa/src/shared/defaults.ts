import { systemAccountId } from './accounts'
import { defaultSync } from './remote-sync'
import { DEFAULT_THEME_ID } from './themes/builtin'
import type { AppSettings, ProviderSettings } from './types'
import { DEFAULT_ZOOM } from './zoom'

/** What a chat says when it goes on after a limit, unless the user wrote their own (`chat.continuePrompt`). */
export const DEFAULT_CONTINUE_PROMPT = 'Mach weiter'

const provider = (): ProviderSettings =>({ enabled: true, path: '', model: '', effort: '', extraArgs: [] })

/**
 * The range of each number setting with a slider, as the slider offers it. A settings file is held to
 * it too (shared/settings-transfer.ts), so both always agree.
 */
export const SETTING_RANGES = {
  'appearance.surfaceOpacity': { min: 20, max: 100, step: 2 },
  'appearance.radius': { min: 0, max: 1.2, step: 0.05 },
  'appearance.uiFontSize': { min: 12, max: 18, step: 1 },
  'notifications.minBusySeconds': { min: 0, max: 300, step: 5 },
  'chat.releaseIdleMinutes': { min: 0, max: 120, step: 5 },
  'notifications.nearLimitPercent': { min: 50, max: 95, step: 5 },
} as const

/**
 * Without input this long (minutes), or with the screen locked, the user counts as away from this
 * computer: the notifications of chats go to the phones too (`notifications.push` „Wenn du weg bist“).
 */
export const PUSH_AWAY_MINUTES = 3

/**
 * How long the file tree's activity may keep a file (seconds), as Einstellungen › Allgemein offers it;
 * a settings file is held to it too.
 */
export const ACTIVITY_CHOICES = [15, 30, 60, 120, 300, 600, 1800] as const

/** Settings of a fresh install; the folder for new projects is filled in by the main process. */
export function defaultSettings(): AppSettings {
  return {
    general: {
      runInTray: false,
      launchAtLogin: false,
      nxReuseChat: true,
      confirmQuitRunning: true,
      // A look at a file passes quickly, a change stays a while.
      activitySeconds: { read: 60, search: 60, write: 300, commit: 120 },
    },
    appearance: {
      theme: DEFAULT_THEME_ID,
      material: 'mica',
      keepMaterialActive: true,
      surfaceOpacity: 72,
      radius: 0.625,
      zoom: DEFAULT_ZOOM,
      uiFontSize: 14,
      uiFont: '',
      codeFont: '',
      // As in the Claude Manager's terminal; Chromium draws them anyway, unless switched off.
      ligatures: true,
      chatWidth: 'normal',
    },
    defaults: {
      provider: 'claude',
      permissionMode: 'ask',
      accounts: { claude: systemAccountId('claude'), codex: systemAccountId('codex'), antigravity: systemAccountId('antigravity') },
      projectsFolder: '',
    },
    claude: provider(),
    codex: provider(),
    antigravity: provider(),
    chat: {
      showThinking: true,
      collapseDiffs: false,
      enterSends: true,
      promptSuggestions: true,
      spellcheck: true,
      spellcheckLanguages: [],
      releaseIdleMinutes: 15,
      autoTitles: true,
      deleteCliConversations: true,
      checkpoints: true,
      shell: 'powershell',
      voiceLanguage: '',
      voiceAccount: '',
      voiceMicrophone: '',
      voiceAutoStop: false,
      voiceAutoSend: false,
      autoSwitch: false,
      continuePrompt: DEFAULT_CONTINUE_PROMPT,
      keepLoginsFresh: true,
    },
    tools: {
      renderTools: true,
      browserTools: true,
      noClaudeInChrome: true,
      // One chat's agent acting in another reaches past what the user set up for each: they turn it on.
      chatTools: false,
    },
    notifications: {
      enabled: true,
      onDone: true,
      // Short answers come while one watches anyway; long work is what one turns away from.
      minBusySeconds: 20,
      onInput: true,
      onLimit: true,
      onNearLimit: true,
      nearLimitPercent: 80,
      onLoginLost: true,
      fromAgents: true,
      when: 'background',
      preview: true,
      sound: true,
      flashTaskbar: true,
      // A phone that turned notifications on in the web app wants them, but not while one sits here.
      push: 'away',
    },
    api: {
      enabled: false,
      port: 47615,
    },
    remote: { sync: defaultSync() },
    // Existing installs lack it too, so they see the setup once after the update that brought it.
    setup: { done: false },
  }
}
