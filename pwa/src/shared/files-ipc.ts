import type {
  ContentSearchResult,
  FileDiff,
  FileListing,
  FileSearchList,
  FileTouch,
  FileTreeWatch,
  GitBranch,
  GitTreeStatus,
  ReviewBase,
  TimedTouch,
  WorktreeCheck,
} from './files'

type Unsubscribe = () => void

/** Channels of the file panel (see main/files/files-ipc.ts). */
export const FilesInvoke = {
  list: 'files:list',
  status: 'files:status',
  searchList: 'files:search-list',
  watch: 'files:watch',
  diff: 'files:diff',
  reviewBase: 'files:review-base',
  create: 'files:create',
  rename: 'files:rename',
  trash: 'files:trash',
  grep: 'files:grep',
  stage: 'files:stage',
  unstage: 'files:unstage',
  discard: 'files:discard',
  hunk: 'files:hunk',
  history: 'files:history',
  gitBranch: 'git:branch',
  gitWatch: 'git:watch',
  gitWebUrl: 'git:web-url',
  gitMainWorktree: 'git:main-worktree',
  gitWorktreeCheck: 'git:worktree-check',
} as const

export const FilesEvent = {
  changed: 'event:files-changed',
  touched: 'event:files-touched',
  gitBranchChanged: 'event:git-branch-changed',
} as const

export interface GitApi {
  /** Branch of the repository `cwd` lies in; null without git or outside a repository. */
  branch(cwd: string): Promise<GitBranch | null>
  /**
   * Reports checkouts in the repositories of these folders through `onBranchChanged`, for each folder.
   * Replaces the folders of the previous call; an empty list stops watching.
   */
  watch(cwds: string[]): Promise<void>
  onBranchChanged(cb: (cwd: string, branch: GitBranch | null) => void): Unsubscribe
  /** Web page of the repository `cwd` lies in, from its remote (GitHub, GitLab …); null without one. */
  webUrl(cwd: string): Promise<string | null>
  /** Folder of the main checkout when `cwd` lies in a linked worktree; null otherwise. */
  mainWorktree(cwd: string): Promise<string | null>
  /** Whether a chat in `cwd` (absolute) can get a worktree of its own, and which there are. */
  worktreeCheck(cwd: string): Promise<WorktreeCheck>
}

/** The file panel of a chat. Paths in a tree are relative to its folder and `/`-separated. */
export interface FilesApi {
  /** The entries of a folder (absolute path), folders first. */
  list(dir: string): Promise<FileListing>
  /** Branch and changed and ignored files of the tree's folder; null outside a repository or without git. */
  status(root: string): Promise<GitTreeStatus | null>
  /** The files of the folder for the search, without the ones git ignores. */
  searchList(root: string): Promise<FileSearchList>
  /** Watches these trees, replacing the ones of the previous call; an empty list stops watching. */
  watch(trees: FileTreeWatch[]): Promise<void>
  /**
   * Entries of these folders (relative, '' is the root) may have changed; `git`: also what git sees
   * (not for changes in folders it ignores); `repo`: the repository itself (a commit, a checkout).
   */
  onChanged(cb: (root: string, dirs: string[], git: boolean, repo: boolean) => void): Unsubscribe
  /**
   * The changes of a file (relative to `root`) since the last commit; `full`: with the whole file around
   * them. With `base` (a commit's hash, see `reviewBase`) its changes since that commit.
   */
  diff(root: string, path: string, full: boolean, base?: string | null): Promise<FileDiff>
  /** Where the work of the folder's branch started, with its commits and changed files since; null without. */
  reviewBase(root: string): Promise<ReviewBase | null>
  /** Makes an empty file or a folder (`dir`) at `path` of an open tree; never over an entry that is there. */
  create(root: string, path: string, dir: boolean): Promise<void>
  /** Renames an entry of an open tree; never over another one. */
  rename(root: string, from: string, to: string): Promise<void>
  /** Moves an entry of an open tree to the recycle bin. */
  trash(root: string, path: string): Promise<void>
  /** The lines of the files of an open tree that hold `query` (any case), without those git ignores. */
  grep(root: string, query: string): Promise<ContentSearchResult>
  /** Stages a changed file of an open tree (`git add`). */
  stage(root: string, path: string): Promise<void>
  /** Takes a file of an open tree out of what is staged. */
  unstage(root: string, path: string): Promise<void>
  /** Gives a file the state of the last commit; the file as it was goes to the recycle bin. */
  discard(root: string, path: string): Promise<void>
  /** Stages a section of a file's changes, or gives it back the state of the last commit (`discard`). */
  hunk(root: string, path: string, change: { patch: string; index: number; discard: boolean }): Promise<void>
  /**
   * What the agent of a session did to files before, from its chat (absolute paths, the oldest first):
   * the tree's activity after a restart. Shell commands' writes are only seen live.
   */
  history(sessionId: string): Promise<TimedTouch[]>
  /** Files the agent of a session reads, searches, writes or commits (absolute paths). */
  onTouched(cb: (sessionId: string, touches: FileTouch[]) => void): Unsubscribe
}
