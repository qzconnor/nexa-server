// The PWA of nexa-server copies this file byte for byte: imports only from `@shared/…`, no Node APIs
// (main/server-link/pwa-copies.test.ts).
import type { FileChange } from '@shared/chat'

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  old: number | null
  new: number | null
}

const MAX_LCS_CELLS = 4_000_000

/** Line diff of two texts (LCS), with up to `context` unchanged lines around each change. */
export function diffTexts(oldText: string, newText: string, context = 3): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split('\n')
  const b = newText === '' ? [] : newText.split('\n')
  // Common head and tail first: an edit usually changes a few lines in the middle.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const ops: { kind: 'add' | 'del' | 'ctx'; text: string }[] = a.slice(0, head).map((text) => ({ kind: 'ctx' as const, text }))
  if (midA.length * midB.length > MAX_LCS_CELLS) {
    for (const text of midA) ops.push({ kind: 'del', text })
    for (const text of midB) ops.push({ kind: 'add', text })
  } else {
    const n = midA.length
    const m = midB.length
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ kind: 'ctx', text: midA[i] })
        i++
        j++
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        ops.push({ kind: 'del', text: midA[i++] })
      } else {
        ops.push({ kind: 'add', text: midB[j++] })
      }
    }
    while (i < n) ops.push({ kind: 'del', text: midA[i++] })
    while (j < m) ops.push({ kind: 'add', text: midB[j++] })
  }
  for (const text of a.slice(a.length - tail)) ops.push({ kind: 'ctx', text })

  // Number the lines, then keep only the context around changes.
  let o = 1
  let nw = 1
  const numbered: DiffLine[] = ops.map((op) => {
    const line: DiffLine = { kind: op.kind, text: op.text, old: op.kind === 'add' ? null : o, new: op.kind === 'del' ? null : nw }
    if (op.kind !== 'add') o++
    if (op.kind !== 'del') nw++
    return line
  })
  const keep = new Array<boolean>(numbered.length).fill(false)
  numbered.forEach((line, idx) => {
    if (line.kind === 'ctx') return
    for (let k = Math.max(0, idx - context); k <= Math.min(numbered.length - 1, idx + context); k++) keep[k] = true
  })
  const out: DiffLine[] = []
  let gap = false
  numbered.forEach((line, idx) => {
    if (!keep[idx]) {
      gap = true
      return
    }
    if (gap && out.length) out.push({ kind: 'hunk', text: '⋯', old: null, new: null })
    gap = false
    out.push(line)
  })
  return out
}

/**
 * A unified diff (Codex's `fileChange`, Claude Code's `structuredPatch`) as lines with the file's own
 * numbers. Between hunks stands a gap like the one `diffTexts` leaves, with the heading git puts after
 * `@@` (the function) if there is one; the numbers already say where the first one starts.
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = []
  let o = 0
  let n = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) continue
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (hunk) {
      o = Number(hunk[1])
      n = Number(hunk[2])
      const heading = hunk[3]!.trim()
      if (out.length || heading) out.push({ kind: 'hunk', text: heading ? `⋯ ${heading}` : '⋯', old: null, new: null })
    } else if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), old: null, new: n++ })
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), old: o++, new: null })
    } else if (raw.startsWith('\\')) {
      continue
    } else if (raw.length || out.length) {
      out.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, old: o++, new: n++ })
    }
  }
  while (out.length && out[out.length - 1].kind === 'ctx' && out[out.length - 1].text === '') out.pop()
  return out
}

/** The lines of a change, from its diff or its old and new text. */
export function changeLines(change: FileChange): DiffLine[] {
  if (change.diff) return parseUnifiedDiff(change.diff)
  if (change.type === 'add') return diffTexts('', change.newText ?? '', 3)
  if (change.type === 'delete') return diffTexts(change.oldText ?? '', '', 3)
  return diffTexts(change.oldText ?? '', change.newText ?? '', 3)
}

export function changeStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added++
    else if (line.kind === 'del') removed++
  }
  return { added, removed }
}
