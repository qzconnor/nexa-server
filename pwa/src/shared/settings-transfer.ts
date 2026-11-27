import { PROVIDER_IDS, type ProviderId } from './chat'
import { ACTIVITY_CHOICES, defaultSettings, SETTING_RANGES } from './defaults'
import { PERMISSION_MODES } from './providers'
import { isLanguageCode, MAX_SPELLCHECK_LANGUAGES } from './spellcheck'
import { CUSTOM_THEME_PREFIX } from './themes/file'
import { THEMES } from './themes/builtin'
import type { ThemeContent } from './themes/types'
import type { AppSettings, DeepPartial } from './types'
import { isPlainObject, mergeKnown, sameData } from './utils'
import { VOICE_LANGUAGES } from './voice'
import { ZOOM_STEPS } from './zoom'

/**
 * Settings to another computer: a file with the settings and the user's own themes, and what such a
 * file would change here, setting by setting, before anything is taken over. Accounts, logins and
 * keys never go into it; the settings only name accounts by their id (see `missingHere` in main).
 */

/** Marks a file with exported settings. */
export const SETTINGS_FILE_FORMAT = 'nexa-settings'
/** Raised only when an older Nexa could no longer read the file. */
export const SETTINGS_FILE_VERSION = 1
/** Exported settings with a few themes are some ten KB; anything far bigger isn't such a file. */
export const MAX_SETTINGS_FILE_BYTES = 2 * 1024 * 1024
/** More themes than anyone makes by hand: a file with more is no export of Nexa's. */
const MAX_FILE_THEMES = 200
/** No setting holds more text; a longer one is no value Nexa wrote. */
const MAX_TEXT = 4000

/**
 * Settings of this installation: an export leaves them out, an import never changes them. The folder
 * for new projects has no row in the settings; its default is in the user's home here.
 */
export const LOCAL_SETTINGS: readonly string[] = ['setup.done', 'defaults.projectsFolder']

/** A theme of the file: the id it had there, so the theme setting can point to it. */
export interface SettingsFileTheme {
  id: string
  theme: ThemeContent
}

/** What a settings file holds besides the settings. */
export interface SettingsFileInfo {
  /** The version of Nexa that exported it, and when; null for a plain settings.json. */
  appVersion: string | null
  exportedAt: string | null
  /** `process.platform` of the computer it came from. */
  platform: string | null
}

/** One setting an import would change. */
export interface SettingChange {
  /** Section and key, e.g. `appearance.zoom` or `defaults.accounts.claude`. */
  path: string
  /** The value now, and the one from the file. */
  from: unknown
  to: unknown
  /**
   * The setting decides what runs or what the agents may do without asking (the CLI's program and
   * its arguments, the default permissions, the message sent after a limit, the local API …). A file
   * from someone else could run anything with it, so it is only taken over when the user picks it.
   */
  sensitive: boolean
}

/** A setting of the file that stays as it is here. */
export interface SkippedSetting {
  /** The setting (`appearance.codeFont`), or `themes` for a theme of the file. */
  path: string
  /** The value in the file; for a theme its name. */
  value: unknown
  /** `missing`: what it names isn't on this computer (a path, an account, a font …); `invalid`: no value Nexa takes. */
  reason: 'missing' | 'invalid'
}

/**
 * What the settings of a file would change, read before anything is taken over: the user picks the
 * changes, which then come as an ordinary update.
 */
export interface SettingsImportPreview extends SettingsFileInfo {
  /** The file's name, without its folder. */
  fileName: string
  /** Each setting the file changes, in the order of the settings. Settings it lacks or has as they are aren't in it. */
  changes: SettingChange[]
  /** The file's own themes that this computer lacks (none of its themes has the name). */
  themes: SettingsFileTheme[]
  skipped: SkippedSetting[]
}

/** The settings as they go into a file: without what belongs to this installation. */
export function exportedSettings(settings: AppSettings): Record<string, unknown> {
  const copy = structuredClone(settings) as unknown as Record<string, unknown>
  for (const path of LOCAL_SETTINGS) deletePath(copy, path)
  return copy
}

/** The content of a settings file. */
export function settingsFile(
  settings: AppSettings,
  themes: readonly SettingsFileTheme[],
  info: { appVersion: string; platform: string; now?: Date },
): Record<string, unknown> {
  return {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    appVersion: info.appVersion,
    platform: info.platform,
    exportedAt: (info.now ?? new Date()).toISOString(),
    settings: exportedSettings(settings),
    themes: themes.map(({ id, theme }) => ({ id, theme })),
  }
}

/** A file's settings and themes as they are in it, still unchecked. */
export interface ReadSettingsFile extends SettingsFileInfo {
  settings: Record<string, unknown>
  /** The themes as the file has them; main checks each (`parseThemeFile`). */
  themes: { id: unknown; theme: unknown }[]
}

/**
 * The settings in an exported file, or the file itself when it is a settings.json from Nexa's data
 * folder. Throws for anything else, and for a file of a newer format.
 */
export function readSettingsFile(data: unknown): ReadSettingsFile {
  if (isPlainObject(data)) {
    if (data.format === SETTINGS_FILE_FORMAT) {
      if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
        throw new Error('Die Datei hat keine gültige Version.')
      }
      if (data.version > SETTINGS_FILE_VERSION) {
        throw new Error('Die Datei stammt aus einer neueren Version von Nexa. Bitte zuerst aktualisieren.')
      }
      if (!isPlainObject(data.settings)) throw new Error('Die Datei enthält keine Einstellungen.')
      const themes = Array.isArray(data.themes) ? data.themes.slice(0, MAX_FILE_THEMES) : []
      return {
        settings: data.settings,
        themes: themes.map((entry) => (isPlainObject(entry) ? { id: entry.id, theme: entry.theme } : { id: null, theme: entry })),
        appVersion: typeof data.appVersion === 'string' && data.appVersion ? data.appVersion.slice(0, 40) : null,
        exportedAt: typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : null,
        platform: typeof data.platform === 'string' && /^[a-z0-9]{1,16}$/.test(data.platform) ? data.platform : null,
      }
    }
    // A settings.json: no format, and at least one section of Nexa's settings.
    const sections = Object.keys(defaultSettings()).filter((key) => key !== 'setup')
    if (!('format' in data) && sections.some((key) => isPlainObject(data[key]))) {
      return { settings: data, themes: [], appVersion: null, exportedAt: null, platform: null }
    }
  }
  throw new Error('Die Datei enthält keine Einstellungen von Nexa.')
}

type Check = (value: unknown) => boolean

const oneOf =
  (values: readonly unknown[]): Check =>
  (value) =>
    values.includes(value)
const inRange =
  (min: number, max: number, integer = false): Check =>
  (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))
/** The range of a slider of the settings. */
const slider = (path: keyof typeof SETTING_RANGES, integer = false): Check => inRange(SETTING_RANGES[path].min, SETTING_RANGES[path].max, integer)
const text =
  (max = MAX_TEXT): Check =>
  (value) =>
    typeof value === 'string' && value.length <= max

/** The ids of the built-in themes, and those of the user's own (`custom:<file>`). */
const themeId: Check = (value) =>
  typeof value === 'string' &&
  (THEMES.some((theme) => theme.id === value) ||
    (value.startsWith(CUSTOM_THEME_PREFIX) && /^[^\\/]{1,120}$/.test(value.slice(CUSTOM_THEME_PREFIX.length)) && !/^\.\.?$/.test(value.slice(CUSTOM_THEME_PREFIX.length))))

/**
 * Values a setting takes, beyond the type of its default (see `validSettings`): choices to the ones
 * the settings offer, numbers to the range of their sliders. Settings not named here take any value
 * of their default's type, e.g. a model's id.
 */
const CHECKS: Record<string, Check> = {
  'general.activitySeconds.read': oneOf(ACTIVITY_CHOICES),
  'general.activitySeconds.search': oneOf(ACTIVITY_CHOICES),
  'general.activitySeconds.write': oneOf(ACTIVITY_CHOICES),
  'general.activitySeconds.commit': oneOf(ACTIVITY_CHOICES),
  'appearance.theme': themeId,
  'appearance.material': oneOf(['none', 'mica', 'acrylic', 'tabbed']),
  'appearance.surfaceOpacity': slider('appearance.surfaceOpacity'),
  'appearance.radius': slider('appearance.radius'),
  'appearance.zoom': oneOf(ZOOM_STEPS),
  'appearance.uiFontSize': slider('appearance.uiFontSize'),
  'appearance.uiFont': text(500),
  'appearance.codeFont': text(500),
  'appearance.chatWidth': oneOf(['normal', 'wide', 'full']),
  'defaults.provider': oneOf(PROVIDER_IDS),
  'defaults.permissionMode': oneOf(Object.keys(PERMISSION_MODES)),
  'chat.shell': oneOf(['powershell', 'gitbash', 'cmd']),
  'chat.spellcheckLanguages': (value) => Array.isArray(value) && value.length <= MAX_SPELLCHECK_LANGUAGES && value.every(isLanguageCode),
  'chat.voiceLanguage': oneOf(['', ...VOICE_LANGUAGES.map((language) => language.code)]),
  'chat.voiceAccount': text(200),
  'chat.voiceMicrophone': text(500),
  'chat.continuePrompt': text(2000),
  'chat.releaseIdleMinutes': slider('chat.releaseIdleMinutes', true),
  'notifications.minBusySeconds': slider('notifications.minBusySeconds', true),
  'notifications.nearLimitPercent': slider('notifications.nearLimitPercent', true),
  'notifications.when': oneOf(['background', 'hidden']),
  'notifications.push': oneOf(['off', 'away', 'always']),
  'api.port': inRange(1024, 65535, true),
}

/** Checks of the settings every CLI has (`claude.path`, `codex.model` …). */
const PROVIDER_CHECKS: Record<string, Check> = {
  path: text(1000),
  model: text(200),
  effort: text(40),
}

function checkOf(path: string): Check | undefined {
  if (CHECKS[path]) return CHECKS[path]
  const [section, key, more] = path.split('.')
  if (more === undefined && (PROVIDER_IDS as readonly string[]).includes(section)) return PROVIDER_CHECKS[key]
  // The default account of each CLI: an account's id.
  if (section === 'defaults' && key === 'accounts' && more !== undefined) return text(200)
  return undefined
}

/** Whether `value` has the type of `expected`, the setting's default; arrays only of short strings. */
function sameType(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === 'string' && item.length <= MAX_TEXT)
  }
  if (typeof expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (typeof expected === 'string') return typeof value === 'string' && value.length <= MAX_TEXT
  return typeof value === typeof expected
}

/**
 * The settings of a file that Nexa takes: those it knows, with a value of the right type and one the
 * setting offers. Unknown ones (of a newer Nexa) are left out quietly, those with a wrong value are
 * named in `invalid`. Local settings (`LOCAL_SETTINGS`) are never taken.
 */
export function validSettings(imported: Record<string, unknown>): { settings: DeepPartial<AppSettings>; invalid: SkippedSetting[] } {
  const invalid: SkippedSetting[] = []
  const walk = (value: Record<string, unknown>, defaults: Record<string, unknown>, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(defaults)) {
      if (!Object.hasOwn(value, key)) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (LOCAL_SETTINGS.includes(path)) continue
      const [actual, expected] = [value[key], defaults[key]]
      if (isPlainObject(expected)) {
        if (isPlainObject(actual)) out[key] = walk(actual, expected, path)
        else invalid.push({ path, value: actual, reason: 'invalid' })
        continue
      }
      const check = checkOf(path)
      if (sameType(actual, expected) && (!check || check(actual))) out[key] = structuredClone(actual)
      else invalid.push({ path, value: actual, reason: 'invalid' })
    }
    return out
  }
  const defaults = defaultSettings() as unknown as Record<string, unknown>
  return { settings: walk(imported, defaults, '') as DeepPartial<AppSettings>, invalid }
}

/** Every setting that differs between `current` and `next`, in the order of the settings. */
export function settingChanges(current: AppSettings, next: AppSettings): SettingChange[] {
  const changes: SettingChange[] = []
  const walk = (from: Record<string, unknown>, to: Record<string, unknown>, prefix: string) => {
    for (const key of Object.keys(from)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (LOCAL_SETTINGS.includes(path)) continue
      const [a, b] = [from[key], to[key]]
      if (isPlainObject(a) && isPlainObject(b)) walk(a, b, path)
      else if (!sameData(a, b)) changes.push({ path, from: structuredClone(a), to: structuredClone(b), sensitive: isSensitive(path, a, b) })
    }
  }
  walk(current as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>, '')
  return changes
}

/** The permission modes from the one that lets the agent do the least to the one that lets it do all. */
const PERMISSION_ORDER = ['plan', 'ask', 'edits', 'auto', 'full']

/**
 * Whether changing the setting at `path` from `from` to `to` needs the user's choice: it decides what
 * runs (a CLI's program and arguments, the message sent on its own after a limit), or it lets the
 * agents or other programs do more than now.
 */
function isSensitive(path: string, from: unknown, to: unknown): boolean {
  const [section, key] = path.split('.')
  if ((PROVIDER_IDS as readonly string[]).includes(section) && (key === 'path' || key === 'extraArgs')) return true
  switch (path) {
    case 'chat.continuePrompt':
      return true
    case 'defaults.permissionMode':
      return PERMISSION_ORDER.indexOf(String(to)) > PERMISSION_ORDER.indexOf(String(from))
    case 'tools.chatTools':
    case 'api.enabled':
      return to === true
    default:
      return false
  }
}

/** The settings patch of some changes: their new values, or with `from` the ones before (to undo). */
export function settingsPatch(changes: readonly SettingChange[], side: 'from' | 'to' = 'to'): DeepPartial<AppSettings> {
  const patch: Record<string, unknown> = {}
  for (const change of changes) {
    const keys = change.path.split('.')
    const last = keys.pop()
    if (!last) continue
    let node = patch
    for (const key of keys) {
      if (!isPlainObject(node[key])) node[key] = {}
      node = node[key] as Record<string, unknown>
    }
    node[last] = structuredClone(change[side])
  }
  return patch as DeepPartial<AppSettings>
}

/**
 * The changes picked, made to fit together: the settings of all CLIs off can't be (one stays on, as
 * the settings keep it), and a CLI switched off can't be the one new chats start with, so the default
 * moves to one that is on, as a change of its own (undone with the others). Null when none would be on.
 */
export function consistentChanges(current: AppSettings, picked: readonly SettingChange[]): SettingChange[] | null {
  const next = mergeKnown(current, settingsPatch(picked))
  const enabled = PROVIDER_IDS.filter((id) => next[id].enabled)
  if (enabled.length === 0) return null
  if (enabled.includes(next.defaults.provider)) return [...picked]
  const others = picked.filter((change) => change.path !== 'defaults.provider')
  const provider: ProviderId = enabled[0]
  if (current.defaults.provider === provider) return others
  return [...others, { path: 'defaults.provider', from: current.defaults.provider, to: provider, sensitive: false }]
}

function deletePath(target: Record<string, unknown>, path: string): void {
  const keys = path.split('.')
  const last = keys.pop()!
  let node: unknown = target
  for (const key of keys) {
    if (!isPlainObject(node)) return
    node = node[key]
  }
  if (isPlainObject(node)) delete node[last]
}
