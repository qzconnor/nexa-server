import type { ToolItem } from '../../shared/chat'

/**
 * Whether a tool call shows opened in the timeline before anyone taps it: commands with their output,
 * what a tool changed in files (unless the computer keeps diffs folded, „Änderungen eingeklappt“, as
 * its chat window does) and whatever failed. Reads, searches and the like stay one line each.
 */
export function opensByItself(tool: Pick<ToolItem, 'tool' | 'status' | 'changes'>, diffsFolded: boolean): boolean {
  if (tool.status === 'error' || tool.tool === 'bash') return true
  return !!tool.changes?.length && !diffsFolded
}

/**
 * Whether a run of tool calls shows its rows: when one of them opens by itself, else it stays its
 * summary. The agent's steps in Nexa's browser stay folded: there are many, and they open singly.
 */
export function groupOpensByItself(tools: readonly Pick<ToolItem, 'tool' | 'status' | 'changes'>[], diffsFolded: boolean, browser = false): boolean {
  return !browser && tools.some((tool) => opensByItself(tool, diffsFolded))
}
