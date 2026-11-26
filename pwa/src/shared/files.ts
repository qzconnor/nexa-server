/**
 * The file panel beside the chat: a folder's entries, git's view of its files, diffs, the content
 * search, and the files the agent touched. Taken over from the Claude Manager (same shapes).
 */

/** The checked-out branch of a git repository. */
export interface GitBranch {
  /** Branch name, or the short commit hash for a detached HEAD. */
  name: string
  detached: boolean
}

/**
 * What a new worktree branches from, as Claude Code's `worktree.baseRef`: `fresh` the default branch of
 * `origin` (`origin/main`), so it starts from what is pushed; `head` the HEAD of the folder it is made from,
 * with commits not pushed yet.
 */
export type WorktreeBaseChoice = 'fresh' | 'head'

/** The files `.worktreeinclude` copies into a new worktree (those git ignores, such as `.env`). */
export interface WorktreeIncludePreview {
  /** How many. */
  files: number
  /** The first few, relative to the main checkout. */
  sample: string[]
  /** Their size; null when there are too many to add up quickly. */
  bytes: number | null
}

/** Whether a chat in `cwd` can get a worktree of its own (as `claude --worktree` makes them, shared/worktree.ts). */
export type WorktreeCheck =
  | {
      ok: true
      /** The repository's main checkout; the worktrees lie in its `.claude\worktrees`. */
      root: string
      /** The HEAD of the checkout `cwd` lies in, what a new worktree starts from with `head`; null when unreadable. */
      head: GitBranch | null
      /**
       * The default branch of `origin` (`origin/main`), what a new worktree starts from with `fresh`; null
       * without a remote `origin`. Not `cached`: git has no such branch yet and fetches it first; when
       * that fails, the worktree starts from HEAD.
       */
      fresh: { ref: string; cached: boolean } | null
      /** What Claude Code's settings choose (`worktree.baseRef`), `fresh` without one. */
      baseRef: WorktreeBaseChoice
      /** Names of the worktrees made there before (by Claude Code or Nexa); one of them is entered again. */
      existing: string[]
      /** Names whose branch `worktree-<name>` is there without a worktree: a new one goes on with it. */
      branches: string[]
      /** Whether git ignores `.claude/worktrees/`; otherwise the main checkout shows them as new files. */
      ignored: boolean
      /** What `.worktreeinclude` in the main checkout copies into a new worktree; null without one. */
      include: WorktreeIncludePreview | null
    }
  | { ok: false; reason: string }

/** The worktree a chat works in (`GitService.addWorktree`). */
export interface AddedWorktree {
  /** Its folder. */
  path: string
  /** Its branch. */
  branch: string
  /** The repository's main checkout. */
  root: string
  /**
   * What it starts from when made or brought up to date now (`origin/main`, a branch, a short commit);
   * missing when one that was there is entered as it was, or a branch left over goes on.
   */
  base?: string
  /** Files `.worktreeinclude` named, copied into a new one, and those that failed. */
  included?: { copied: string[]; failed: string[] }
}

/** How a chat's worktree is made (`GitService.addWorktree`). */
export interface WorktreeOptions {
  /** What a new one branches from; `fresh` by default, as in Claude Code. */
  base?: WorktreeBaseChoice
  /**
   * Whether a chat works in the folder already: one that is entered again is only brought up to date
   * with `fresh` while none does.
   */
  inUse?: (path: string) => boolean
}

/** An entry of a folder in the file tree. */
export interface FileEntry {
  name: string
  /** A folder, also behind a link. */
  dir: boolean
  /** A symbolic link or junction. */
  link: boolean
  /** A link whose target is missing. */
  broken: boolean
}

/** A folder's entries, folders first, each part sorted by name like the Explorer does. */
export interface FileListing {
  entries: FileEntry[]
  /** Entries left out because the folder has too many. */
  omitted: number
}

/** The files of a tree's folder, for the search across folders that are not open. */
export interface FileSearchList {
  /** Paths relative to the folder, `/`-separated. In a repository without the ones git ignores. */
  paths: string[]
  /** More files than were listed. */
  truncated: boolean
}

/** A line of a file that holds what the tree's content search looks for. */
export interface ContentMatch {
  /** Its number in the file, from 1. */
  line: number
  /** The line without its indent; of a long one the part around its first hit, `…` where cut. */
  text: string
  /** Where the hits are in `text` (characters, the end excluded). */
  ranges: [number, number][]
}

/** The lines of a file the content search found, by their number. */
export interface ContentFile {
  /** Relative to the tree's folder, `/`-separated. */
  path: string
  matches: ContentMatch[]
}

export interface ContentSearchResult {
  files: ContentFile[]
  /** Lines found, in all files. */
  matches: number
  /** More lines than were read hold it, or the search took too long. */
  truncated: boolean
}

/** How git sees a file of the tree. */
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

export interface GitFileState {
  status: GitFileStatus
  /** The change is staged, at least partly. */
  staged: boolean
  /** Lines added and removed since the last commit; null for binary and untracked files and before the first commit. */
  added: number | null
  removed: number | null
}

/** A commit of a review (see `ReviewBase`). */
export interface ReviewCommit {
  sha: string
  short: string
  subject: string
  author: string
  /** ISO date of the commit's author. */
  date: string
}

/**
 * Where the work of a folder's branch started: its changes since then, committed or not, as a review
 * of the whole branch shows them.
 */
export interface ReviewBase {
  /** The branch compared with, as git names it (`origin/main`); on the main branch its upstream. */
  base: string
  /** The commit the branch started from (`git merge-base`). */
  mergeBase: string
  /** The checked-out branch; null with a detached HEAD. */
  branch: string | null
  /** Commits since, the latest first. */
  commits: ReviewCommit[]
  /** There were more commits than were sent. */
  commitsTruncated: boolean
  /** The folder's files changed since, by their path relative to it; files git doesn't know yet aren't in it. */
  files: Record<string, GitFileState>
  /** More files than were sent. */
  truncated: boolean
  /** Where to open a pull request of the branch; null on an unknown host, on the main branch and before it is pushed. */
  pullRequestUrl: string | null
}

/** Git's view of a tree's folder: the branch and the changed and ignored files in it. */
export interface GitTreeStatus {
  /** The checked-out branch; null with a detached HEAD. */
  branch: string | null
  /** Short hash of HEAD; null before the first commit. */
  commit: string | null
  /** The branch the checked-out one follows, e.g. `origin/main`. */
  upstream: string | null
  /** Commits ahead of and behind the upstream. */
  ahead: number
  behind: number
  /** Changed files by their path relative to the tree's folder (`/`-separated); untracked folders end with `/`. */
  files: Record<string, GitFileState>
  /** Ignored files and folders (ending with `/`), relative to the tree's folder. */
  ignored: string[]
  /** More changes or ignored paths than were sent. */
  truncated: boolean
}

/** A file's changes since the last commit, or the file itself when there are none to show. */
export interface FileDiff {
  /** `git diff HEAD` of the file, staged and unstaged changes together; '' without changes or outside a repository. */
  patch: string
  /** The file as it is when there is no patch: unchanged, not yet known to git, or outside a repository. */
  text: string | null
  /** The folder is a git repository with a commit to compare with. */
  repo: boolean
  binary: boolean
  /** Too big to show. */
  tooLarge: boolean
  /** The file isn't there (deleted, or not yet written). */
  missing: boolean
  /**
   * An image (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO) as data URLs: as at the last commit, if it changed
   * since, and as it is now. Null for a side that isn't there or is too big to show.
   */
  image?: { before: string | null; after: string | null }
}

/** What Claude does with a file: reads it, searches it (or a search found it), writes it, or commits it. */
export type FileTouchKind = 'read' | 'search' | 'write' | 'commit'

/** A file Claude touched, by its absolute path. */
export interface FileTouch {
  path: string
  kind: FileTouchKind
}

/** A touch from a session's history, with when it happened (ms). */
export interface TimedTouch extends FileTouch {
  at: number
}

/** The side of the chat a file tree is on. */
export type FileTreeSide = 'left' | 'right'

/** A tree whose folders the main process watches: its folder, and (Linux) the open subfolders. */
export interface FileTreeWatch {
  root: string
  /** Open folders relative to `root` (`/`-separated); on Windows and macOS the whole folder is watched anyway. */
  dirs: string[]
}
