import type { ToolItem } from '../../shared/chat'

/** What the timeline shows opened before anyone taps it (Einstellungen › Chatverlauf, per device). */
export interface UnfoldSettings {
  /** Commands with their output. */
  commands: boolean
  /** What a tool changed in files, as a diff. */
  changes: boolean
  /** Whatever failed, with what went wrong. */
  failures: boolean
  /** The agent's thoughts. */
  thinking: boolean
}

/** Commands stay one line: an agent runs many, and their output would bury its answer on a phone. */
export const DEFAULT_UNFOLD: Readonly<UnfoldSettings> = { commands: false, changes: true, failures: true, thinking: true }

/** The stored choice over the defaults; what isn't a yes or no (an older or broken entry) keeps its default. */
export function parseUnfold(stored: unknown): UnfoldSettings {
  const settings = { ...DEFAULT_UNFOLD }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return settings
  for (const key of Object.keys(settings) as (keyof UnfoldSettings)[]) {
    const value = (stored as Record<string, unknown>)[key]
    if (typeof value === 'boolean') settings[key] = value
  }
  return settings
}

/**
 * Whether a tool call shows opened in the timeline before anyone taps it, as `unfold` says: commands,
 * what a tool changed in files and whatever failed. Changes stay folded too while the computer keeps
 * diffs folded („Änderungen eingeklappt“), as its chat window does. Reads, searches and the like stay
 * one line each.
 */
export function opensByItself(tool: Pick<ToolItem, 'tool' | 'status' | 'changes'>, unfold: UnfoldSettings, diffsFolded: boolean): boolean {
  if (tool.status === 'error' && unfold.failures) return true
  if (tool.tool === 'bash' && unfold.commands) return true
  return unfold.changes && !diffsFolded && !!tool.changes?.length
}

/**
 * Whether a run of tool calls shows its rows: when one of them opens by itself, else it stays its
 * summary. The agent's steps in Nexa's browser stay folded: there are many, and they open singly.
 */
export function groupOpensByItself(
  tools: readonly Pick<ToolItem, 'tool' | 'status' | 'changes'>[],
  unfold: UnfoldSettings,
  diffsFolded: boolean,
  browser = false,
): boolean {
  return !browser && tools.some((tool) => opensByItself(tool, unfold, diffsFolded))
}
