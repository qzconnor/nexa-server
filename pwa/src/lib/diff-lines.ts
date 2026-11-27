import type { FileChange } from '../shared/chat'

/** Lines shown of one change at most: a phone isn't the place to read a whole file. */
const MAX_LINES = 400

/**
 * Lines of a change, coloured: its unified diff (Codex), else the replaced and the new text (Claude's
 * Edit, Write) as removed and added lines.
 */
export function changeLines(change: FileChange): { text: string; tone: string }[] {
  if (change.diff) {
    return change.diff
      .split('\n')
      .slice(0, MAX_LINES)
      .map((text) => ({
        text,
        tone: text.startsWith('+') && !text.startsWith('+++') ? 'text-success' : text.startsWith('-') && !text.startsWith('---') ? 'text-destructive' : '',
      }))
  }
  const removed = change.oldText ? change.oldText.split('\n').map((line) => ({ text: `- ${line}`, tone: 'text-destructive' })) : []
  const added = change.newText ? change.newText.split('\n').map((line) => ({ text: `+ ${line}`, tone: 'text-success' })) : []
  return [...removed, ...added].slice(0, MAX_LINES)
}

export const CHANGE_LABEL: Record<FileChange['type'], string> = { add: 'neu', update: 'geändert', delete: 'gelöscht' }
