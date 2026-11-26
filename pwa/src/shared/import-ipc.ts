import type { AccountKind } from './accounts'
import type { ProviderId } from './chat'
import type { Unsubscribe } from './ipc'

/**
 * Taking over from the Claude Manager (see main/import/claude-manager.ts): its workspaces become
 * projects, its accounts Nexa's (with the same config folders), and the Claude Code sessions in
 * those folders chats that go on where they left off; besides, its workspace prompts, themes and the
 * names and pins of sessions. Run again, it offers only what Nexa doesn't have yet.
 */

export const ImportInvoke = {
  detect: 'import:cm-detect',
  installed: 'import:cm-installed',
  scan: 'import:cm-scan',
  run: 'import:cm-run',
} as const

export const ImportEvent = {
  /** How far the scan of the sessions is. */
  progress: 'event:import-progress',
} as const

/** The Claude Manager's data folder, if it has one on this computer. */
export interface ClaudeManagerFound {
  dir: string
  workspaces: number
  accounts: number
}

export interface ImportAccount {
  name: string
  provider: ProviderId
  kind: AccountKind
  color: string
  /**
   * `create`: becomes a Nexa account with the same folder; `exists`: Nexa has an account with it;
   * `merge`: Nexa has its login in another folder (`into`), its sessions go on with that account;
   * `standard`: the CLI's standard account, which Nexa has too; `skip`: can't be taken over (its token
   * or key is encrypted for the Claude Manager alone).
   */
  action: 'create' | 'exists' | 'merge' | 'standard' | 'skip'
  /** `merge`: the name of the account it joins. */
  into?: string
}

/** A folder whose sessions become one project. */
export interface ImportGroup {
  path: string
  name: string
  /**
   * `workspace`: one of the Claude Manager, becomes a separator with its subfolders as projects;
   * `project`: a project Nexa has; `folder`: a folder of its own, becomes a project under the default separator.
   */
  kind: 'workspace' | 'project' | 'folder'
  exists: boolean
  /** Sessions to take over (those Nexa has already not counted). */
  sessions: number
  /** Sessions in folders below the folder itself. */
  inSubfolders: number
  /** A workspace: the projects its sessions go to under the separator (one per subfolder of the first level). */
  projects?: number
  /** Newest session, ms; null without. */
  updatedAt: number | null
}

/**
 * Something besides the sessions that the Claude Manager has and Nexa not yet, also after an earlier
 * import: `prompt` a workspace's prompt (its `cm_prompts.md` becomes the folder's `prompts.md`),
 * `theme` one of its own themes, `names` and `pins` names and pins given there to sessions Nexa
 * has as chats already.
 */
export interface ImportExtra {
  /** What the input chooses it by. */
  id: string
  kind: 'prompt' | 'theme' | 'names' | 'pins'
  label: string
  /** A line more: the prompt's beginning, the sessions' names. */
  detail?: string
  /** Why it can't be taken over; it is shown, not offered. */
  blocked?: string
}

export interface ImportPreview {
  dir: string
  accounts: ImportAccount[]
  groups: ImportGroup[]
  extras: ImportExtra[]
  /** Sessions Nexa has taken over before. */
  known: number
  /** Sessions without a folder or that never got going. */
  skipped: number
}

export interface ImportInput {
  /** The `path`s of the groups to take over. */
  groups: string[]
  /** The `id`s of the extras to take over (the Claude Manager's import only). */
  extras?: string[]
}

export interface ImportResult {
  sections: number
  projects: number
  sessions: number
  accounts: number
  /** Of the extras: prompts written, themes added, chats renamed and pinned. */
  prompts: number
  themes: number
  names: number
  pins: number
}

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportApi {
  /** Its data folder; it stays when the Claude Manager is uninstalled. */
  detect(): Promise<ClaudeManagerFound | null>
  /** Whether the Claude Manager itself is installed (its hints in Nexa show only then). */
  installed(): Promise<boolean>
  /** Reads the Claude Manager's folders and the sessions in its accounts' folders. */
  scan(): Promise<ImportPreview>
  /** Takes over the groups of the last scan. */
  run(input: ImportInput): Promise<ImportResult>
  onProgress(cb: (progress: ImportProgress) => void): Unsubscribe
}

/*
 * Taking over the CLIs' own sessions (main/import/cli-import.ts): the conversations Claude Code and
 * Codex saved in the folders of Nexa's accounts, from the terminal, an IDE or their apps, become chats
 * in the projects of their folders.
 */

export const CliImportInvoke = {
  scan: 'import:cli-scan',
  run: 'import:cli-run',
} as const

export const CliImportEvent = {
  progress: 'event:cli-import-progress',
} as const

/** A folder whose sessions become one project: one Nexa has (`project`) or a new one (`folder`). */
export interface CliImportGroup extends ImportGroup {
  kind: 'project' | 'folder'
  /** Its sessions by CLI. */
  counts: Record<ProviderId, number>
}

export interface CliImportPreview {
  groups: CliImportGroup[]
  /** Sessions Nexa has as chats already. */
  known: number
  /** Sessions without a folder or that never got going. */
  skipped: number
  /** What couldn't be read, one line each („Codex (Standard): …“). */
  failed: string[]
}

export interface CliImportResult {
  projects: number
  sessions: number
}

export interface CliImportApi {
  /** Reads the sessions in the folders of every account of the CLIs in use. */
  scan(): Promise<CliImportPreview>
  /** Takes over the groups of the last scan. */
  run(input: ImportInput): Promise<CliImportResult>
  onProgress(cb: (progress: ImportProgress) => void): Unsubscribe
}
