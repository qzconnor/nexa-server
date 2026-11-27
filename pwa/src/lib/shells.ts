import type { ChatItem, ShellStatus, ToolItem } from '@shared/chat'

/** A shell command: Claude Code's Bash, Codex's command execution. */
function isCommand(tool: ToolItem): boolean {
  return tool.tool === 'bash' || tool.name === 'commandExecution'
}

/** What became of a command's process: its own state when the CLI tracks it, else its call's. */
export function shellStatus(tool: ToolItem): ShellStatus {
  if (tool.shell) return tool.shell.status
  if (tool.status === 'running' || tool.status === 'pending') return 'running'
  if (tool.status === 'error') return 'error'
  return tool.status === 'denied' ? 'stopped' : 'done'
}

/** The command line itself, else what the row shows of it. */
export function shellCommand(tool: ToolItem): string {
  const input = tool.input as { command?: unknown } | undefined
  return typeof input?.command === 'string' && input.command.trim() ? input.command : (tool.detail ?? tool.title)
}

/** What the agent said the command is for (Claude's Bash has `description`). */
export function shellPurpose(tool: ToolItem): string | null {
  const value = (tool.input as { description?: unknown } | undefined)?.description
  return typeof value === 'string' && value.trim() ? value : null
}

/** Since when it runs, or how long it ran. */
export function shellEnd(tool: ToolItem): number | undefined {
  return tool.shell ? tool.shell.endedAt : tool.endedAt
}

export { plainOutput } from '@shared/terminal'

const START_PREFIX = 'start:'

/** The id a start command of the chat's project is unfolded by in the dock; no tool item's id looks like it. */
export function startShellId(commandId: string): string {
  return `${START_PREFIX}${commandId}`
}

/** The start command a panel id stands for; null for a tool item's. */
export function startCommandOf(shellId: string | null | undefined): string | null {
  return shellId?.startsWith(START_PREFIX) ? shellId.slice(START_PREFIX.length) : null
}

/** The shells of a chat that run right now, oldest first: in the background or the foreground, subagents' too. */
export function runningShells(items: readonly ChatItem[]): ToolItem[] {
  return items.filter((i): i is ToolItem => i.kind === 'tool' && isCommand(i) && shellStatus(i) === 'running')
}

/**
 * The dock's rows: its shells, and the one unfolded when it isn't among them (opened from its row in
 * the chat, in the foreground or long ended). Oldest first.
 */
export function dockRows(items: readonly ChatItem[], dock: readonly ToolItem[], openId: string | null): ToolItem[] {
  if (!openId || dock.some((s) => s.id === openId)) return [...dock]
  const open = items.find((i): i is ToolItem => i.kind === 'tool' && i.id === openId)
  return open ? [...dock, open].sort((a, b) => a.startedAt - b.startedAt) : [...dock]
}

/**
 * Above the composer while a shell runs in the background: those started since the last prompt (the
 * finished ones stay while another runs, so it shows how they went) and those still at work from
 * before. Commands in the foreground show in the chat as they run, so they stay out.
 */
export function dockShells(items: readonly ChatItem[]): ToolItem[] {
  const lastPrompt = items.findLastIndex((i) => i.kind === 'user' && !i.parentId)
  const list = items.filter(
    (i, index): i is ToolItem => i.kind === 'tool' && !!i.shell?.background && (index > lastPrompt || i.shell.status === 'running'),
  )
  return list.some((s) => s.shell?.status === 'running') ? list : []
}
