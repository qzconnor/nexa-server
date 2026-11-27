import type { Account, AccountCreateInput, AccountLoginState, AccountUpdateInput, LoginRenewResult } from './accounts'
import type { ArtifactsApi } from './artifacts'
import type { ChatWindowsApi } from './chat-windows'
import type { CliConfigApi, CliConfigTarget } from './cli-config'
import type { ChatChanges, RewindPreview, RewindResult } from './checkpoints'
import type { FileDiff } from './files'
import type { InboxEntry } from './inbox'
import type { ContextDetail, InteractionResponse, ProviderId, SessionEvent, SessionRuntime } from './chat'
import type { McpAppsApi } from './mcp-apps'
import type { AgentNotification, AgentNotificationAnswer } from './notify'
import type { ScheduledApi } from './scheduled-tasks'
import type { SettingsImportPreview } from './settings-transfer'
import type { AppTheme, CustomThemeEntry, ThemeContent, ThemeImportResult } from './themes/types'
import type {
  ApiStatus,
  AppDialogRequest,
  AppInfo,
  AppSettings,
  CommandOption,
  CommandStatus,
  DeepPartial,
  FolderPromptInfo,
  McpAuthStart,
  McpServerInfo,
  ModelDefaults,
  ModelOption,
  Platform,
  PluginInfo,
  Project,
  ProjectSection,
  PromptTarget,
  ProviderStatus,
  ProviderUsage,
  UsageStats,
  SendInput,
  SessionCreateInput,
  SessionDetail,
  SessionMeta,
  SessionMoveInput,
  SessionRemoveResult,
  SessionSearchHit,
  SessionStorage,
  SessionUpdateInput,
  ShellOutput,
  WindowState,
} from './types'
import type { FilesApi, GitApi } from './files-ipc'
import type { BrowserApi } from './browser-ipc'
import type { UpdatesApi } from './updates'
import type { CliImportApi, ImportApi } from './import-ipc'
import type { SectionLayout } from './sections'
import type { RemoteApi } from './remote-ipc'
import type { ServerLinkApi } from './server-link'
import type { StartCommandsApi } from './start-commands'
import type { TerminalsApi } from './terminals'
import type { VoiceApi } from './voice'

/** Request/response channels (ipcRenderer.invoke ↔ ipcMain.handle). */
export const IpcInvoke = {
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appOpenPath: 'app:open-path',
  appShowItem: 'app:show-item',
  appPickDirectory: 'app:pick-directory',
  appPickImages: 'app:pick-images',
  appPickFiles: 'app:pick-files',
  appSaveImage: 'app:save-image',
  appListFonts: 'app:list-fonts',
  /** The main window's answer to a question of the main process (`IpcEvent.appDialog`). */
  appDialogAnswer: 'app:dialog-answer',
  /** The questions still open, for a main window that starts listening. */
  appDialogsPending: 'app:dialogs-pending',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowState: 'window:state',
  windowSetTitleBarColors: 'window:set-title-bar-colors',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsExport: 'settings:export',
  settingsImportPreview: 'settings:import-preview',

  themesList: 'themes:list',
  themesCreate: 'themes:create',
  themesSave: 'themes:save',
  themesRemove: 'themes:remove',
  themesExport: 'themes:export',
  themesImport: 'themes:import',
  themesOpenFile: 'themes:open-file',
  themesShowFile: 'themes:show-file',
  themesOpenFolder: 'themes:open-folder',

  providersList: 'providers:list',
  providersRefresh: 'providers:refresh',
  providersModels: 'providers:models',
  providersModelDefaults: 'providers:model-defaults',
  providersCommands: 'providers:commands',

  accountsList: 'accounts:list',
  accountsRefresh: 'accounts:refresh',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  accountsMerge: 'accounts:merge',
  accountsReorder: 'accounts:reorder',
  accountsLogins: 'accounts:logins',
  accountsLogin: 'accounts:login',
  accountsLoginCode: 'accounts:login-code',
  accountsLoginCancel: 'accounts:login-cancel',
  accountsRenewLogin: 'accounts:renew-login',
  accountsLogout: 'accounts:logout',

  usageGet: 'usage:get',
  usageRefresh: 'usage:refresh',
  usageStats: 'usage:stats',

  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsPrompt: 'projects:prompt',
  projectsSetPrompt: 'projects:set-prompt',
  projectsRemove: 'projects:remove',
  projectsArrange: 'projects:arrange',
  projectsToSection: 'projects:to-section',
  sectionsList: 'sections:list',
  sectionsCreate: 'sections:create',
  sectionsUpdate: 'sections:update',
  sectionsRemove: 'sections:remove',

  sessionsList: 'sessions:list',
  sessionsRuntimes: 'sessions:runtimes',
  sessionsCreate: 'sessions:create',
  sessionsOpen: 'sessions:open',
  sessionsSend: 'sessions:send',
  sessionsEdit: 'sessions:edit',
  sessionsInterrupt: 'sessions:interrupt',
  sessionsRespond: 'sessions:respond',
  sessionsShellOutput: 'sessions:shell-output',
  sessionsStopShell: 'sessions:stop-shell',
  sessionsRunShell: 'sessions:run-shell',
  sessionsContext: 'sessions:context',
  sessionsMcpServers: 'sessions:mcp-servers',
  sessionsSetMcp: 'sessions:set-mcp',
  sessionsReconnectMcp: 'sessions:reconnect-mcp',
  sessionsAuthenticateMcp: 'sessions:authenticate-mcp',
  sessionsConfigTarget: 'sessions:config-target',
  sessionsPlugins: 'sessions:plugins',
  sessionsSetPlugin: 'sessions:set-plugin',
  sessionsSync: 'sessions:sync',
  sessionsSeen: 'sessions:seen',
  sessionsInbox: 'sessions:inbox',
  sessionsUpdate: 'sessions:update',
  sessionsRemove: 'sessions:remove',
  sessionsStorage: 'sessions:storage',
  sessionsStop: 'sessions:stop',
  sessionsRestart: 'sessions:restart',
  sessionsResumeAtReset: 'sessions:resume-at-reset',
  sessionsSearch: 'sessions:search',
  sessionsMove: 'sessions:move',
  sessionsCompact: 'sessions:compact',
  sessionsFork: 'sessions:fork',
  sessionsClear: 'sessions:clear',
  sessionsExportMarkdown: 'sessions:export-markdown',
  sessionsLastAnswer: 'sessions:last-answer',
  sessionsChanges: 'sessions:changes',
  /** A picture of a chat's prompts, for another device's window (main/window/file-protocol.ts); no call of the window API. */
  sessionsImage: 'sessions:image',
  sessionsChangeDiff: 'sessions:change-diff',
  sessionsRewindPreview: 'sessions:rewind-preview',
  sessionsRewind: 'sessions:rewind',
  sessionsRewindUndo: 'sessions:rewind-undo',

  notificationsViewing: 'notifications:viewing',
  notificationsTest: 'notifications:test',
  notificationsAnswer: 'notifications:answer',

  apiStatus: 'api:status',

  commandStatus: 'command:status',
  commandSetRegistered: 'command:set-registered',
} as const

/** Events from main to the window. */
export const IpcEvent = {
  /** A question or message of the main process, for the main window's own dialog (`AppDialogRequest`). */
  appDialog: 'event:app-dialog',
  windowState: 'event:window-state',
  settingsChanged: 'event:settings-changed',
  /** A file in the themes folder came, went or changed (also by hand). */
  themesChanged: 'event:themes-changed',
  /** The app wrote a theme, with the theme. */
  themesSaved: 'event:themes-saved',
  providersChanged: 'event:providers-changed',
  accountsChanged: 'event:accounts-changed',
  /** A browser login of an account moved on (link known, done, failed). */
  accountsLogin: 'event:accounts-login',
  usageChanged: 'event:usage-changed',
  projectsChanged: 'event:projects-changed',
  sectionsChanged: 'event:sections-changed',
  sessionsChanged: 'event:sessions-changed',
  sessionEvent: 'event:session',
  /** The `nx` command or the local API asks the window to show a session. */
  showSession: 'event:show-session',
  /** `nx -r` without an id: the quick open with the folder's chats (the query). */
  findSessions: 'event:find-sessions',
  /** A notification about an account's limits or login asks the window to show them in the settings. */
  openSettings: 'event:open-settings',
  /** An agent notifies the user (`notify`): the window shows it as a toast. */
  agentNotification: 'event:agent-notification',
  /** A notification of an agent was answered or taken back: its toasts go. */
  agentNotificationDone: 'event:agent-notification-done',
} as const

/** The sections of the settings a notification leads to. */
export type NotifiedSettings = 'usage' | 'accounts'

export type Unsubscribe = () => void

export interface ProjectCreateInput {
  path: string
  name?: string
  /** Create the folder if it doesn't exist. */
  create?: boolean
  /** The separator it comes under; else the one whose folder it lies in, else the default one. */
  sectionId?: string
}

export interface SectionCreateInput {
  name?: string
  /** The folder it stands for (its subfolders are the projects in it). */
  path?: string
  /** The separator it comes after; else it comes last. */
  after?: string
}

export type SectionUpdateInput = Partial<Pick<ProjectSection, 'name' | 'collapsed'>>

export interface NexaApi {
  platform: Platform
  /** The file panel beside the chat (shared/files-ipc.ts). */
  files: FilesApi
  git: GitApi
  /** The browser beside each chat (shared/browser-ipc.ts). */
  browser: BrowserApi
  /** New versions and their release notes (shared/updates.ts). */
  updates: UpdatesApi
  /** Taking over from the Claude Manager (shared/import-ipc.ts). */
  claudeManager: ImportApi
  /** Taking over the sessions in the CLIs' own folders (shared/import-ipc.ts). */
  cliImport: CliImportApi
  /** Claude's artifacts on claude.ai (shared/artifacts.ts). */
  artifacts: ArtifactsApi
  /** Prompts Nexa sends on a schedule (shared/scheduled-tasks.ts). */
  scheduled: ScheduledApi
  /** The pages of MCP tools in the chat (shared/mcp-apps.ts). */
  mcpApps: McpAppsApi
  /** The microphone in the composer, recognised by Claude (shared/voice.ts). */
  voice: VoiceApi
  /** The projects' start commands, run as shells beside the chats (shared/start-commands.ts). */
  startCommands: StartCommandsApi
  /** The user's terminals beside the chats (shared/terminals.ts). */
  terminals: TerminalsApi
  /** The CLIs' own settings: MCP servers, permissions, hooks (shared/cli-config.ts). */
  cliConfig: CliConfigApi
  /** Chats in windows of their own (shared/chat-windows.ts). */
  chatWindows: ChatWindowsApi
  /** The pairing with a nexa-server and the devices of the namespace (shared/server-link.ts). */
  serverLink: ServerLinkApi
  /** Remote Control: the chats of other devices, and who controls this one (shared/remote-ipc.ts). */
  remote: RemoteApi
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    showItem(path: string): Promise<void>
    pickDirectory(defaultPath?: string): Promise<string | null>
    pickImages(): Promise<string[]>
    /** Any files, for the composer's „Dateien oder Fotos hinzufügen“. */
    pickFiles(defaultPath?: string): Promise<string[]>
    /** Saves an image pasted into the composer, returns its path. */
    saveImage(data: Uint8Array, mime: string): Promise<string>
    /** The installed font families, for the font pickers of the settings. */
    listFonts(): Promise<string[]>
    pathForFile(file: File): string
    /** What the main process asks or tells (quitting while chats work, …): in the app, never a native box. */
    onDialog(cb: (request: AppDialogRequest) => void): Unsubscribe
    /** The answer to `onDialog`'s request: true for its button, false when cancelled. */
    answerDialog(id: number, ok: boolean): Promise<void>
    /** What was asked before the window listened (it loaded, or reloaded, meanwhile). */
    pendingDialogs(): Promise<AppDialogRequest[]>
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    state(): Promise<WindowState>
    /** The caption buttons' colors, and whether the theme is dark (the native backdrop and menus follow it). */
    setTitleBarColors(colors: { color: string; symbolColor: string; dark?: boolean }): Promise<void>
    onState(cb: (state: WindowState) => void): Unsubscribe
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    /** Saves the settings and the user's own themes to a file the user picks; its path, null when cancelled. */
    exportToFile(): Promise<string | null>
    /** What a file the user picks would change, without taking anything over; null when cancelled. */
    previewImport(): Promise<SettingsImportPreview | null>
    onChanged(cb: (settings: AppSettings) => void): Unsubscribe
    /** A click on a notification about an account's limits or login: the window shows that section. */
    onOpen(cb: (section: NotifiedSettings) => void): Unsubscribe
  }
  /** Notifications about chats that are done or need the user (main `notification-service.ts`). */
  notifications: {
    /** The chat the window shows (null: none); its notification has been seen then. */
    viewing(sessionId: string | null): Promise<void>
    /** Shows an example notification with the current settings. */
    test(): Promise<void>
    /** The user answered a notification of an agent in its toast: a button, or closed it. */
    answer(id: string, answer: AgentNotificationAnswer): Promise<void>
    onAgent(cb: (notification: AgentNotification) => void): Unsubscribe
    onAgentDone(cb: (id: string) => void): Unsubscribe
  }
  /** The user's own themes, one JSON file each in the folder `themes` of the app's data. */
  themes: {
    /** Every file of the folder; ones that can't be used with the reason. */
    list(): Promise<CustomThemeEntry[]>
    /** Saves a new theme (a name another theme has gets a number). */
    create(theme: ThemeContent): Promise<CustomThemeEntry>
    /** Saves the theme `id`; a new name renames its file, so its id changes. */
    save(id: string, theme: ThemeContent): Promise<CustomThemeEntry>
    /** Moves the file to the recycle bin. */
    remove(id: string): Promise<void>
    /** Saves the theme to a file the user picks. The path, or null when cancelled. */
    export(id: string): Promise<string | null>
    /** Takes over themes from `files`, or from files the user picks without; null when cancelled. */
    import(files?: string[]): Promise<ThemeImportResult | null>
    /** Opens the file in the program for JSON; false when there is none (the file is shown in Explorer then). */
    openFile(id: string): Promise<boolean>
    /** Shows the file selected in Explorer (the file manager). */
    showFile(id: string): Promise<void>
    openFolder(): Promise<void>
    onChanged(cb: () => void): Unsubscribe
    /** A theme the app wrote, before the folder's watcher reports it. */
    onSaved(cb: (entry: CustomThemeEntry) => void): Unsubscribe
  }
  providers: {
    list(): Promise<ProviderStatus[]>
    refresh(): Promise<ProviderStatus[]>
    models(provider: ProviderId): Promise<ModelOption[]>
    /** What a model runs with when no effort is named; `account`: one of the CLI's, else its default. */
    modelDefaults(provider: ProviderId, account: string | undefined, model: string): Promise<ModelDefaults>
    /** The commands and skills the composer offers in a folder (null: the user's home, no project yet). */
    commands(provider: ProviderId, account: string | undefined, cwd: string | null): Promise<CommandOption[]>
    onChanged(cb: (list: ProviderStatus[]) => void): Unsubscribe
  }
  /** Several logins per CLI, each with its own config folder (see shared/accounts.ts). */
  accounts: {
    list(): Promise<Account[]>
    /** Reads the logins from the CLIs' files again. */
    refresh(): Promise<Account[]>
    create(input: AccountCreateInput): Promise<Account>
    update(id: string, patch: AccountUpdateInput): Promise<Account>
    /** `deleteFolder`: also Nexa's profile folder of the account (never one the user picked). */
    remove(id: string, deleteFolder: boolean): Promise<void>
    /** Folds `from` into `into` (the same login): its chats go on with `into`, its folder stays. */
    merge(from: string, into: string): Promise<void>
    /** The accounts in this order (those not named keep their places). */
    reorder(ids: string[]): Promise<void>
    /** The browser logins that run. */
    logins(): Promise<AccountLoginState[]>
    /** Starts the CLI's browser login for the account. */
    login(id: string): Promise<AccountLoginState>
    /** A code the browser showed, for the CLI that waits for it. */
    loginCode(id: string, code: string): Promise<void>
    cancelLogin(id: string): Promise<void>
    /** „Jetzt erneuern“: a new access token for a Claude browser login, also while the old one works. */
    renewLogin(id: string): Promise<LoginRenewResult>
    /** Signs the account's browser login out (CLIs with `ProviderMeta.signOut`). */
    logout(id: string): Promise<void>
    onChanged(cb: (list: Account[]) => void): Unsubscribe
    onLogin(cb: (state: AccountLoginState) => void): Unsubscribe
  }
  usage: {
    get(): Promise<ProviderUsage[]>
    /** Reads the limits of every account, also of those whose CLI isn't running. */
    refresh(): Promise<ProviderUsage[]>
    /** Tokens and turns of Nexa's chats per day, the last `days` days. */
    stats(days: number): Promise<UsageStats>
    onChanged(cb: (list: ProviderUsage[]) => void): Unsubscribe
  }
  projects: {
    list(): Promise<Project[]>
    create(input: ProjectCreateInput): Promise<Project>
    update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed'>>): Promise<Project>
    /** The prompt of a project or a separator for a folder (`prompts.md`; the import takes the Claude Manager's `cm_prompts.md` over). */
    prompt(target: PromptTarget): Promise<FolderPromptInfo>
    /** Its chats get it from the next start of their CLI on. */
    setPrompt(target: PromptTarget, text: string): Promise<void>
    /** With its chats (as `sessions.remove`). */
    remove(id: string): Promise<SessionRemoveResult>
    onChanged(cb: (list: Project[]) => void): Unsubscribe
    /** The order of separators and projects after a drag and drop (shared/sections.ts). */
    arrange(layout: SectionLayout[]): Promise<void>
    /** Makes a project a separator for its folder: its subfolders with chats become projects under it. */
    toSection(id: string): Promise<ProjectSection>
    sections(): Promise<ProjectSection[]>
    createSection(input: SectionCreateInput): Promise<ProjectSection>
    updateSection(id: string, patch: SectionUpdateInput): Promise<ProjectSection>
    /** Its projects go to the default separator. */
    removeSection(id: string): Promise<void>
    onSectionsChanged(cb: (list: ProjectSection[]) => void): Unsubscribe
  }
  sessions: {
    list(): Promise<SessionMeta[]>
    /** What each chat that isn't idle does now (its later changes come as `onEvent`). */
    runtimes(): Promise<Record<string, SessionRuntime>>
    /** The chats that need the user, with what they wait for: the inbox of the app and of the phone. */
    inbox(): Promise<InboxEntry[]>
    create(input: SessionCreateInput): Promise<SessionMeta>
    /** The session with its chat; doesn't start the CLI. */
    open(id: string): Promise<SessionDetail>
    send(id: string, input: SendInput): Promise<void>
    /**
     * Sends a prompt of the chat anew, changed: everything after it goes, and the CLIs go on from the
     * answer before it (not while the chat works).
     */
    edit(id: string, itemId: string, input: SendInput): Promise<void>
    interrupt(id: string): Promise<void>
    respond(id: string, itemId: string, response: InteractionResponse): Promise<void>
    /** The end of a shell's output (`itemId`: its tool item, see `ToolItem.shell`). */
    shellOutput(id: string, itemId: string): Promise<ShellOutput>
    stopShell(id: string, itemId: string): Promise<void>
    /** Runs a command the user typed after `!` in the chat's folder; it shows in the chat, secrets masked. */
    runShell(id: string, command: string): Promise<void>
    /** What fills the chat's context, by kind, if its CLI tells (Claude Code while it runs). */
    context(id: string): Promise<ContextDetail | null>
    /** The MCP servers of the chat's CLI, each on or off for its project. */
    mcpServers(id: string): Promise<McpServerInfo[]>
    /** Switches a server on or off for the chat's project (its running chats take it at once or with the next prompt). */
    setMcp(id: string, name: string, enabled: boolean): Promise<void>
    /** Connects a server of the chat's CLI anew (one that failed, or signed in since). */
    reconnectMcp(id: string, name: string): Promise<void>
    /** Starts a server's sign-in: the page to open; null when it needs none. */
    authenticateMcp(id: string, name: string): Promise<McpAuthStart | null>
    /** The settings of the chat's CLI and account for its folder, for „Konnektoren verwalten“. */
    configTarget(id: string): Promise<CliConfigTarget>
    /** The plugins the chat's CLI has installed for its folder. */
    plugins(id: string): Promise<PluginInfo[]>
    /** Switches a plugin in the CLI's own settings; its running chats load the plugins anew. */
    setPlugin(id: string, pluginId: string, enabled: boolean): Promise<void>
    /**
     * Takes what was added to the chat's CLI conversations outside Nexa into the chat, and looks where
     * else one is open (`SessionRuntime.openElsewhere`); the number of items added.
     */
    sync(id: string): Promise<number>
    /** A window shows the chat: what it finished counts as read, on every device (`isUnread`). */
    seen(id: string): Promise<void>
    update(id: string, patch: SessionUpdateInput): Promise<SessionMeta>
    /** Deletes chats, with their CLIs' conversations into the recycle bin (setting `chat.deleteCliConversations`). */
    remove(ids: string[]): Promise<SessionRemoveResult>
    /** What each chat takes on disk, for clearing up. */
    storage(): Promise<SessionStorage[]>
    /** Ends the CLI process of the session; the next prompt resumes it. */
    stop(id: string): Promise<void>
    /** Ends the CLI process of the session and starts it again on the same conversation, with the settings as they are now. */
    restart(id: string): Promise<void>
    /**
     * „Am Reset fortsetzen“ for a chat at its account's limit: it goes on by itself once the limit resets
     * (`SessionRuntime.resume`); `on` false stops that, also a wait of the automatic account switch.
     */
    resumeAtReset(id: string, on: boolean): Promise<void>
    /** Chats whose prompts and answers hold every word of `query`; empty: reads them ahead for the next search. */
    search(query: string): Promise<SessionSearchHit[]>
    /** Into another project or folder: the chat goes on there with its conversation (not while its CLI works). */
    move(id: string, target: SessionMoveInput): Promise<SessionMeta>
    /** Has the chat's CLI compact its conversation now (Codex; Claude Code gets `/compact` as a prompt). */
    compact(id: string): Promise<void>
    /** A new chat that goes on from where this one is now, with each CLI's conversation forked (not while its CLI works). */
    fork(id: string): Promise<SessionMeta>
    /** Empties the context in the same chat (`/clear`): the next prompt starts a new conversation (not while its CLI works). */
    clear(id: string): Promise<SessionMeta>
    /** Saves the chat as Markdown where the user picks; the file's path, or null when cancelled. */
    exportMarkdown(id: string): Promise<string | null>
    /** What the agent said last in the chat; null before it said anything. */
    lastAnswer(id: string): Promise<string | null>
    /**
     * What each prompt of the chat changed in its folders (Nexa's checkpoints) and the rewind that can be
     * taken back; `live`: with what the running turn changed so far.
     */
    changes(id: string, live?: boolean): Promise<ChatChanges>
    /** One file's change by a prompt, as a patch; `full` with the whole file around it. */
    changeDiff(id: string, promptId: string, path: string, full: boolean): Promise<FileDiff>
    /** What rewinding the files to before a prompt would do (not while the chat works). */
    rewindPreview(id: string, promptId: string): Promise<RewindPreview>
    /** Puts the files the agent changed from that prompt on back as they were before it. */
    rewind(id: string, promptId: string): Promise<RewindResult>
    /** Takes the chat's last rewind of files back. */
    rewindUndo(id: string): Promise<RewindResult>
    onChanged(cb: (list: SessionMeta[]) => void): Unsubscribe
    onEvent(cb: (event: SessionEvent) => void): Unsubscribe
    onShow(cb: (id: string) => void): Unsubscribe
    /** `nx -r` without an id: the quick open, searching for `query` (the folder's project). */
    onFind(cb: (query: string) => void): Unsubscribe
  }
  api: {
    status(): Promise<ApiStatus>
  }
  /** The `nx` command: on the user PATH and in the Explorer's address bar (Windows, installed app). */
  command: {
    status(): Promise<CommandStatus>
    /** Registers or unregisters it through nx.exe; the state afterwards. */
    setRegistered(registered: boolean): Promise<CommandStatus>
  }
}

export type { AppTheme }
