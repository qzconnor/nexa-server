import type {
  BrowserActivity,
  BrowserControlState,
  BrowserCredentials,
  BrowserDownload,
  BrowserDownloadAction,
  BrowserFrame,
  BrowserHighlight,
  BrowserLoginRequest,
  BrowserPage,
  BrowserShortcut,
  BrowserTabInfo,
  BrowserTabsState,
} from './browser'

type Unsubscribe = () => void

/** Channels of the chats' browser (see main/browser/browser-ipc.ts). */
export const BrowserInvoke = {
  tabs: 'browser:tabs',
  openTab: 'browser:open-tab',
  closeTab: 'browser:close-tab',
  showTab: 'browser:show-tab',
  page: 'browser:page',
  attach: 'browser:attach',
  favicon: 'browser:favicon',
  log: 'browser:log',
  clearLog: 'browser:clear-log',
  takeOver: 'browser:take-over',
  controls: 'browser:controls',
  clearData: 'browser:clear-data',
  resetViewport: 'browser:reset-viewport',
  resetEmulation: 'browser:reset-emulation',
  resetRoutes: 'browser:reset-routes',
  downloads: 'browser:downloads',
  downloadAction: 'browser:download-action',
  clearDownloads: 'browser:clear-downloads',
  loginAnswer: 'browser:login-answer',
  watchFrames: 'browser:watch-frames',
} as const

export const BrowserEvent = {
  /** The tabs of the chats' browsers changed (all of them). */
  tabs: 'event:browser-tabs',
  /**
   * A key of a page that belongs to the browser around it (Ctrl+L, F5 …), which the window doesn't
   * see, or a mouse button for back and forward; with the page's contents id (null: the shown one).
   */
  shortcut: 'event:browser-shortcut',
  /** A link of a page (by its contents id) wants a tab of its own. */
  openTab: 'event:browser-open-tab',
  downloads: 'event:browser-downloads',
  login: 'event:browser-login',
  loginDone: 'event:browser-login-done',
  /** An agent did something in a browser, or a running action ended. */
  activity: 'event:browser-activity',
  /** Who drives a browser changed. */
  control: 'event:browser-control',
  /** Where an agent acts in the page right now. */
  highlight: 'event:browser-highlight',
  /** The page needs the window's keyboard for an agent's keys. */
  focus: 'event:browser-focus',
  /** The user clicked into a browser page, which the window doesn't see. */
  userClick: 'event:browser-user-click',
  /** A picture of a watched tab's page (`watchFrames`). */
  frame: 'event:browser-frame',
} as const

/** The browser beside each chat: its tabs, their pages and what the agents do in them. */
export interface BrowserApi {
  tabs(): Promise<BrowserTabsState>
  /** A new tab in the chat's browser, shown unless `background`. */
  openTab(sessionId: string, url?: string | null, background?: boolean): Promise<BrowserTabInfo>
  closeTab(id: string): Promise<void>
  showTab(sessionId: string, id: string): Promise<void>
  /** What a tab shows now; it takes the page's title. */
  page(id: string, page: BrowserPage): Promise<void>
  /** The page of a tab is ready: main can drive it for the agent. */
  attach(id: string, webContentsId: number): Promise<void>
  /** The icon a page names, as a data URL the window can show; null when it is no image. */
  favicon(url: string): Promise<string | null>
  /** What the agents did in the tab so far, oldest first. */
  log(id: string): Promise<BrowserActivity[]>
  clearLog(id: string): Promise<void>
  /** The user takes the tab over from the agent, or hands it back. */
  takeOver(id: string, takenOver: boolean): Promise<void>
  /** Who drives which tab, by the tab's id. */
  controls(): Promise<Record<string, BrowserControlState>>
  /** Logs the browser out everywhere: cookies, the sites' stored data and the cache. */
  clearData(): Promise<void>
  /** The page fills its panel again, instead of the size the agent gave it. */
  resetViewport(id: string): Promise<void>
  /** The page stops pretending what the agent had it pretend (dark mode, slow network …). */
  resetEmulation(id: string): Promise<void>
  /** Ends the agent's routes for the page's requests (browser_route). */
  resetRoutes(id: string): Promise<void>
  /** The browser's downloads, oldest first. */
  downloads(): Promise<BrowserDownload[]>
  downloadAction(id: string, action: BrowserDownloadAction): Promise<void>
  /** Takes the downloads off the list that are no longer running; the files stay. */
  clearDownloads(): Promise<void>
  /** The user's answer to a page's question for a login; null cancels it. */
  answerLogin(id: string, credentials: BrowserCredentials | null): Promise<void>
  /** Live pictures of a tab's page start or stop coming (`onFrame`); calls are counted per window. */
  watchFrames(id: string, on: boolean): Promise<void>
  onTabs(cb: (state: BrowserTabsState) => void): Unsubscribe
  onShortcut(cb: (shortcut: BrowserShortcut, contentsId: number | null) => void): Unsubscribe
  /** `background`: without the keyboard, like Chrome (middle click, Ctrl+click). */
  onOpenTab(cb: (contentsId: number, url: string, background: boolean) => void): Unsubscribe
  onDownloads(cb: (downloads: BrowserDownload[]) => void): Unsubscribe
  onLogin(cb: (request: BrowserLoginRequest) => void): Unsubscribe
  onLoginDone(cb: (id: string) => void): Unsubscribe
  onActivity(cb: (id: string, activity: BrowserActivity) => void): Unsubscribe
  onControl(cb: (id: string, control: BrowserControlState | null) => void): Unsubscribe
  onHighlight(cb: (id: string, highlight: BrowserHighlight) => void): Unsubscribe
  /** The agent is about to type into the page: it needs the window's keyboard for a moment. */
  onFocus(cb: (id: string) => void): Unsubscribe
  /** The user clicked into the page (the agent's clicks aside). */
  onUserClick(cb: (id: string) => void): Unsubscribe
  onFrame(cb: (id: string, frame: BrowserFrame) => void): Unsubscribe
}
