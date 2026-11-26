/**
 * Nexa's own browser: one per chat, beside it, with tabs of web pages in a profile of their own
 * (cookies, storage) apart from the app and the user's browser. The agents drive it through Nexa's
 * MCP server (main's BrowserControl). Ported from Claude Manager.
 */

/** A tab of a chat's browser, as main keeps it (src/main/browser/browser-tabs.ts). */
export interface BrowserTabInfo {
  id: string
  /** The chat (Nexa session) whose browser it belongs to. */
  sessionId: string
  url: string
  title: string
  /** The agent opened it (it may close it again); the user's own tabs stay. */
  openedByAgent: boolean
}

/** All tabs of all chats, oldest first, and the one each chat's browser shows. */
export interface BrowserTabsState {
  tabs: BrowserTabInfo[]
  /** By session id. */
  shown: Record<string, string>
}

/** What a browser shows, as its page reports it. */
export interface BrowserPage {
  url: string
  title: string
}

/** Where a download of the browser stands. */
export type BrowserDownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

/** A file the browser downloads or downloaded, into the user's downloads folder; one list for all tabs. */
export interface BrowserDownload {
  id: string
  /** The page it came from (the id of its contents), so its pane can show it; 0 when unknown. */
  contentsId: number
  /** The name it got in the folder (with a number when the name was taken). */
  filename: string
  path: string
  url: string
  state: BrowserDownloadState
  receivedBytes: number
  /** 0 when the server didn't say. */
  totalBytes: number
  /** ISO time. */
  startedAt: string
  /** Opening it runs it (a program, installer or script): the list asks first. */
  executable: boolean
  /** The browser refused it, e.g. one of too many a page started at once. */
  refused: boolean
}

/** What the user can do with a download in the list. */
export type BrowserDownloadAction = 'open' | 'show' | 'cancel' | 'remove'

/** A site (or a proxy) asks for a user name and password (HTTP authentication) before it shows the page. */
export interface BrowserLoginRequest {
  id: string
  /** The page that asks (the id of its contents); its pane shows the question. */
  contentsId: number
  /** Host, with the port when it is not the scheme's own. */
  host: string
  /** The name the site gives the protected area; may be empty. */
  realm: string
  /** A proxy asks, not the site. */
  proxy: boolean
  /** The password would go over an unencrypted connection (http). */
  insecure: boolean
}

export interface BrowserCredentials {
  username: string
  password: string
}

/** How an action of the agent in a browser went; `warning`: the page reported an error by itself. */
export type BrowserActivityStatus = 'running' | 'done' | 'error' | 'warning'

/** One line of the log next to a browser that an agent drives. */
export interface BrowserActivity {
  /** Counts up per browser; the update of a running action keeps its id. */
  id: number
  /** When it started (ISO). */
  at: string
  /** The tool (`click`, `navigate` …); `console`, `network` and `page-dialog` for what the page did, `control` for the user taking over. */
  kind: string
  /** In words, e.g. „Klickt auf „Anmelden““. */
  label: string
  status: BrowserActivityStatus
  /**
   * The agent reached beyond what the page shows: uploaded files, the site's cookies or storage, the
   * contents of a request, a script, its data deleted. The log keeps these lines longest.
   */
  sensitive: boolean
  /** The error, or what came out of it. */
  detail: string | null
  durationMs: number | null
  /** A small picture of the page, when the agent took a screenshot (JPEG data URL). */
  image: string | null
}

/** The page size an agent gave a browser (CSS pixels), instead of the size of its panel. */
export interface BrowserViewport {
  width: number
  height: number
  /** Phone mode: touch, a phone's user agent, the page's viewport meta tag. */
  mobile: boolean
  /** The page's zoom when the size was set: its view is this much larger in the window. */
  zoom: number
}

/** Who drives a browser tab. */
export interface BrowserControlState {
  /** The chat whose agent uses the browser. */
  sessionId: string
  sessionTitle: string
  /** The agent's short name (Claude, Codex) for the status over the page. */
  agent: string
  /** An action runs right now. */
  busy: boolean
  /** The agent acted a moment ago: the page keeps its size and is drawn even while its panel is hidden. */
  active: boolean
  /** The user took the browser over; the agent's next action waits until it is handed back. */
  takenOver: boolean
  /** The size the agent gave the page; null: it fills its panel. */
  viewport: BrowserViewport | null
  /** What the agent has the page pretend (dark mode, slow network …); null: nothing. */
  emulation: BrowserEmulation | null
  /** Requests the agent answers, slows down or blocks itself (browser_route); they end with its run. */
  routes: BrowserRoute[]
}

/** A route of the agent's for the page's requests, as the badge over the page shows it. */
export interface BrowserRoute {
  id: number
  /** The addresses it takes: `*` matches anything; without `*` an address that contains it. */
  pattern: string
  /** Only requests with this method (GET, POST …); null: all. */
  method: string | null
  /** fulfill: the agent's answer; fail: a network error; delay: the real answer, later. */
  action: 'fulfill' | 'fail' | 'delay'
  /** The status of the agent's answer (fulfill). */
  status: number | null
  delayMs: number
  /** How many requests it took so far. */
  hits: number
  /** It ends after this many more requests; null: with the run. */
  timesLeft: number | null
}

/** A network as the agent can have the page feel it (Chrome's presets). */
export type BrowserNetworkPreset = 'offline' | 'slow-3g' | 'fast-3g' | 'fast-4g'

/** Permissions the agent can give the page or refuse it (browser_emulate). */
export type BrowserPermission = 'geolocation' | 'notifications' | 'camera' | 'microphone' | 'clipboard-read'

/** Where the page believes it is (browser_emulate). */
export interface BrowserGeolocation {
  latitude: number
  longitude: number
  /** Meters. */
  accuracy: number
}

/** What the agent has the page pretend (browser_emulate); it ends with its run or the user's reset. */
export interface BrowserEmulation {
  /** `prefers-color-scheme`; null: the system's. */
  colorScheme: 'light' | 'dark' | null
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean
  network: BrowserNetworkPreset | null
  /** The page runs this many times slower (2–20); null: at full speed. */
  cpuSlowdown: number | null
  /** Language and formats, e.g. `de-DE`; null: the app's. */
  locale: string | null
  /** IANA time zone, e.g. `America/New_York`; null: the computer's. */
  timezone: string | null
  /** Where the page believes it is; it also gets the permission for the location. null: nowhere. */
  geolocation: BrowserGeolocation | null
  /** Permissions the page gets or is refused; those left out the browser refuses as always. */
  permissions: Partial<Record<BrowserPermission, 'granted' | 'denied'>>
}

/** A picture of a page for the chat's preview of the browser. */
export interface BrowserFrame {
  /** JPEG data URL. */
  url: string
  /** The page's size as drawn (device pixels), for the preview's proportions. */
  width: number
  height: number
}

/** Where the agent acts in the page, for the highlight over it; in pixels of the view. */
export interface BrowserHighlight {
  label: string
  rect: { x: number; y: number; width: number; height: number } | null
  /** Where the agent's mouse pointer goes, gliding from its last spot; null: it stays where it is. */
  point: { x: number; y: number } | null
  /** The pointer clicks once it is at `point`. */
  click: boolean
  /** How long the pointer takes to get to `point` (ms); main acts once it is there. */
  moveMs: number
}

/** Keys of a browser page that belong to the browser around it or to the app (main sees them, the window doesn't). */
export type BrowserShortcut =
  | 'browser-address'
  | 'browser-reload'
  | 'browser-reload-hard'
  | 'browser-devtools'
  | 'browser-find'
  | 'browser-find-next'
  | 'browser-find-previous'
  | 'browser-back'
  | 'browser-forward'
  | 'browser-close-tab'
  | 'browser-new-tab'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'open-settings'

/** What the matcher reads of a key event: a DOM `KeyboardEvent`, or the main process' copy of an input event. */
export interface ShortcutKey {
  type: string
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * The zoom keys with Ctrl, as in browsers: plus larger (1), minus smaller (-1), 0 back to normal (0).
 * Plus counts with Shift too, which some layouts need to type it (US: Shift+=), and as `=`.
 */
export function zoomKey(e: ShortcutKey): 1 | -1 | 0 | null {
  const key = e.key.toLowerCase()
  if (key === '+' || key === '=' || e.code === 'NumpadAdd') return 1
  if (key === '-' || e.code === 'NumpadSubtract') return -1
  if (key === '0' && !e.shiftKey) return 0
  return null
}

/**
 * Keys of a browser page that belong to the browser around it, like in Chrome: Ctrl+L goes to the
 * address bar, F5 and Ctrl+R load the page again, Ctrl+Shift+R, Shift+F5 and Ctrl+F5 without the
 * cache, Ctrl+F searches the page and F3 (Shift+F3) jumps to the next (previous) match, F12 and
 * Ctrl+Shift+I open the DevTools, Ctrl+T and Ctrl+W open and close tabs, Ctrl+plus/minus/0 zoom the
 * page. Ctrl+, stays the app's (its settings). Back and forward buttons of the mouse come from the
 * window as app commands.
 */
export function matchBrowserShortcut(e: ShortcutKey): BrowserShortcut | null {
  if (e.type !== 'keydown' || e.altKey || e.metaKey) return null
  const ctrl = e.ctrlKey
  if (e.key === 'F5') return e.shiftKey || ctrl ? 'browser-reload-hard' : 'browser-reload'
  if (e.key === 'F12' && !ctrl && !e.shiftKey) return 'browser-devtools'
  if (e.key === 'F3' && !ctrl) return e.shiftKey ? 'browser-find-previous' : 'browser-find-next'
  if (!ctrl) return null
  const zoom = zoomKey(e)
  if (zoom !== null) return zoom === 1 ? 'zoom-in' : zoom === -1 ? 'zoom-out' : 'zoom-reset'
  const key = e.key.toLowerCase()
  if (e.shiftKey) {
    if (key === 'r') return 'browser-reload-hard'
    if (key === 'i') return 'browser-devtools'
    return null
  }
  if (key === 'l') return 'browser-address'
  if (key === 'r') return 'browser-reload'
  if (key === 'f') return 'browser-find'
  if (key === 't') return 'browser-new-tab'
  if (key === 'w') return 'browser-close-tab'
  if (key === ',') return 'open-settings'
  return null
}

export const BROWSER_PARTITION = 'persist:browser'
export const BLANK_PAGE = 'about:blank'
export const DEFAULT_BROWSER_TITLE = 'Neuer Tab'
/** Longest address that is kept and restored. */
export const MAX_URL_LENGTH = 8192

const SEARCH_URL = 'https://www.google.com/search?q='
/** A host with an optional port and path: `example.com`, `localhost:5173/app`, `192.168.0.2:8080`, `[::1]:3000`. */
const HOST_RE = /^(localhost|\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}][\p{L}\p{N}-]*)(:\d{1,5})?([/?#].*)?$/iu
/** Hosts that hardly ever speak https: the address gets `http://`. */
const LOCAL_HOST_RE = /^(localhost|\[[0-9a-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3})(:|\/|\?|#|$)/i

/** A page the browser may show: http(s) or the empty page. */
export function isBrowsableUrl(url: string): boolean {
  if (url === BLANK_PAGE) return true
  if (url.length > MAX_URL_LENGTH) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * What the address bar makes of the input: an address as typed (`https://` added when the scheme is
 * missing, `http://` for local hosts), a web search for anything else.
 */
export function addressToUrl(input: string): string {
  const text = input.trim()
  if (!text) return BLANK_PAGE
  if (/^https?:\/\//i.test(text) || text.toLowerCase() === BLANK_PAGE) {
    return isBrowsableUrl(text) ? text : SEARCH_URL + encodeURIComponent(text)
  }
  if (!/\s/.test(text) && HOST_RE.test(text)) {
    const url = `${LOCAL_HOST_RE.test(text) ? 'http' : 'https'}://${text}`
    if (isBrowsableUrl(url)) return url
  }
  return SEARCH_URL + encodeURIComponent(text)
}

/** The address as the address bar shows it: nothing for the empty page. */
export function addressOf(url: string | null): string {
  return !url || url === BLANK_PAGE ? '' : url
}

/** A title for a page that has none (yet): its host, or the default for the empty page. */
export function fallbackTitle(url: string | null): string {
  if (!url || url === BLANK_PAGE) return DEFAULT_BROWSER_TITLE
  try {
    return new URL(url).host || DEFAULT_BROWSER_TITLE
  } catch {
    return DEFAULT_BROWSER_TITLE
  }
}

const NETWORK_LABELS: Record<BrowserNetworkPreset, string> = {
  offline: 'Offline',
  'slow-3g': 'Langsames 3G',
  'fast-3g': 'Schnelles 3G',
  'fast-4g': '4G',
}

/**
 * Drops the oldest lines of a browser's log beyond `limit`, the sensitive ones (uploads, cookies …)
 * only when nothing else is left, so they stay to be looked up.
 */
export function trimLog(log: { sensitive: boolean }[], limit: number): void {
  while (log.length > limit) {
    const plain = log.findIndex((line) => !line.sensitive)
    log.splice(plain === -1 ? 0 : plain, 1)
  }
}

export const NO_EMULATION: BrowserEmulation = {
  colorScheme: null,
  reducedMotion: false,
  network: null,
  cpuSlowdown: null,
  locale: null,
  timezone: null,
  geolocation: null,
  permissions: {},
}

const PERMISSION_LABELS: Record<BrowserPermission, string> = {
  geolocation: 'Standort',
  notifications: 'Benachrichtigungen',
  camera: 'Kamera',
  microphone: 'Mikrofon',
  'clipboard-read': 'Zwischenablage lesen',
}

/** What Claude has the page pretend, as short German labels for the log and the badge over the page. */
export function emulationLabels(emulation: BrowserEmulation): string[] {
  const labels: string[] = []
  if (emulation.colorScheme) labels.push(emulation.colorScheme === 'dark' ? 'Dunkel' : 'Hell')
  if (emulation.reducedMotion) labels.push('Weniger Bewegung')
  if (emulation.network) labels.push(NETWORK_LABELS[emulation.network])
  if (emulation.cpuSlowdown) labels.push(`CPU ${emulation.cpuSlowdown}× langsamer`)
  if (emulation.locale) labels.push(emulation.locale)
  if (emulation.timezone) labels.push(emulation.timezone)
  if (emulation.geolocation) labels.push(`Standort ${emulation.geolocation.latitude.toFixed(2)}, ${emulation.geolocation.longitude.toFixed(2)}`)
  for (const [name, setting] of Object.entries(emulation.permissions) as [BrowserPermission, string][]) {
    labels.push(`${PERMISSION_LABELS[name]} ${setting === 'granted' ? 'erlaubt' : 'verweigert'}`)
  }
  return labels
}

/** A route of Claude's as a short German label, e.g. "GET /api/users → 500". */
export function routeLabel(route: BrowserRoute): string {
  const target = `${route.method ? `${route.method} ` : ''}${route.pattern}`
  const delay = route.delayMs ? ` +${route.delayMs} ms` : ''
  if (route.action === 'fail') return `${target} blockiert${delay}`
  if (route.action === 'delay') return `${target}${delay}`
  return `${target} → ${route.status ?? 200}${delay}`
}
