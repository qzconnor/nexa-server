// What the prompts of a chat changed in its folders, from Nexa's own checkpoints (main/files/checkpoints.ts):
// one for every CLI, since Claude Code keeps none in the mode Nexa runs it in, Codex's `thread/revert`
// leaves the files and ACP has nothing of the kind (docs/PROTOCOLS.md, „Checkpoints“).

/** How a file differs: it came, it changed, it went. */
export type FileChangeStatus = 'added' | 'modified' | 'deleted'

/** One file a prompt changed. */
export interface ChangedFile {
  /** Absolute, with the system's separators. */
  path: string
  /** The folder of the chat it is in (its working folder or one added to it). */
  root: string
  /** Within `root`, with `/`. */
  rel: string
  status: FileChangeStatus
  /** Lines; null for a file that isn't text. */
  insertions: number | null
  deletions: number | null
}

/** What one prompt changed, from before it to the end of its turn. */
export interface PromptChanges {
  /** The id of the prompt's `UserItem`. */
  promptId: string
  at: number
  /** Its turn still runs: what changed so far. */
  open: boolean
  files: ChangedFile[]
  /** Files left out of the checkpoints (too big, links), absolute. */
  skipped: string[]
  /** Why a folder has no checkpoints (too big, the user's home folder), in words. */
  unavailable?: string
}

/** The count a turn shows below itself (`TurnItem.fileChanges`). */
export interface FileChangeSummary {
  files: number
  insertions: number
  deletions: number
}

/** A file as rewinding would leave it: `status` says what happens to it as it is now. */
export interface RewindFile extends ChangedFile {
  /** Changed since by someone else than the agent (the user, another program): that goes too. */
  outside: boolean
}

/** What rewinding to before a prompt would do. */
export interface RewindPreview {
  promptId: string
  files: RewindFile[]
  /** Changed by the agent, but left out of the checkpoints: they stay as they are. */
  skipped: string[]
  unavailable?: string
}

export interface RewindResult {
  files: number
  failed: { path: string; error: string }[]
}

/** The checkpoints of a chat: each prompt's changes and the rewind that can be undone. */
export interface ChatChanges {
  prompts: PromptChanges[]
  undo: { promptId: string; at: number; files: number } | null
  /** Off in the settings: no new checkpoints. */
  disabled?: boolean
}
