/** A terminal of the user beside a chat: a shell in a pseudo console (node-pty), drawn by xterm. */
export interface TerminalInfo {
  id: string
  /** The chat it belongs to: it starts in its folder, with the environment of its account. */
  sessionId: string
  /** „PowerShell 7“, „Git Bash“, „zsh“ … */
  shell: string
  cwd: string
  /** The account whose CLI the terminal reaches (CLAUDE_CONFIG_DIR, CODEX_HOME); null: the standard one. */
  account: string | null
  status: 'running' | 'exited'
  exitCode: number | null
  createdAt: number
}

/** What a terminal wrote so far, to draw it in a new view, and where that ends in all it ever wrote. */
export interface TerminalBuffer {
  text: string
  /** Counted in characters of all output; a later chunk ends past it (see `TerminalsApi.onData`). */
  end: number
}

export interface TerminalSize {
  cols: number
  rows: number
}

export const TerminalsInvoke = {
  list: 'terminals:list',
  create: 'terminals:create',
  buffer: 'terminals:buffer',
  write: 'terminals:write',
  resize: 'terminals:resize',
  kill: 'terminals:kill',
} as const

export const TerminalsEvent = {
  /** Output of a terminal: its id, the text and where it ends (`TerminalBuffer.end`). */
  data: 'event:terminal-data',
  /** A terminal started, ended or went. */
  changed: 'event:terminals-changed',
} as const

export interface TerminalsApi {
  list(): Promise<TerminalInfo[]>
  /** Starts a shell for the chat, in its folder; throws when the shell isn't there. */
  create(sessionId: string, size: TerminalSize): Promise<TerminalInfo>
  buffer(id: string): Promise<TerminalBuffer>
  write(id: string, data: string): Promise<void>
  resize(id: string, size: TerminalSize): Promise<void>
  /** Ends the shell and what it started, and drops the terminal. */
  kill(id: string): Promise<void>
  onData(cb: (id: string, data: string, end: number) => void): () => void
  onChanged(cb: (terminals: TerminalInfo[]) => void): () => void
}
