import { describe, expect, it } from 'vitest'
import type { FileChange } from '../../shared/chat'
import { groupOpensByItself, opensByItself } from './unfold'

const change = { path: 'a.ts', type: 'update', diff: '-a\n+b' } as FileChange

describe('opensByItself', () => {
  it('opens commands, changes and failures', () => {
    expect(opensByItself({ tool: 'bash', status: 'running' }, false)).toBe(true)
    expect(opensByItself({ tool: 'edit', status: 'done', changes: [change] }, false)).toBe(true)
    expect(opensByItself({ tool: 'read', status: 'error' }, false)).toBe(true)
  })

  it('keeps reads, searches and tools without changes folded', () => {
    expect(opensByItself({ tool: 'read', status: 'done' }, false)).toBe(false)
    expect(opensByItself({ tool: 'search', status: 'done' }, false)).toBe(false)
    expect(opensByItself({ tool: 'edit', status: 'running', changes: [] }, false)).toBe(false)
  })

  it('folds changes when the computer keeps diffs folded, commands and failures not', () => {
    expect(opensByItself({ tool: 'edit', status: 'done', changes: [change] }, true)).toBe(false)
    expect(opensByItself({ tool: 'bash', status: 'done' }, true)).toBe(true)
    expect(opensByItself({ tool: 'edit', status: 'error', changes: [change] }, true)).toBe(true)
  })
})

describe('groupOpensByItself', () => {
  it('opens a run with a command or a change in it', () => {
    expect(groupOpensByItself([{ tool: 'read', status: 'done' }, { tool: 'bash', status: 'done' }], false)).toBe(true)
    expect(groupOpensByItself([{ tool: 'read', status: 'done' }, { tool: 'search', status: 'done' }], false)).toBe(false)
  })

  it('keeps the browser steps folded', () => {
    expect(groupOpensByItself([{ tool: 'other', status: 'error' }], false, true)).toBe(false)
  })
})
