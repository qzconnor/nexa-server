import { describe, expect, it } from 'vitest'
import type { FileChange } from '../../shared/chat'
import { DEFAULT_UNFOLD, groupOpensByItself, opensByItself, parseUnfold, type UnfoldSettings } from './unfold'

const change = { path: 'a.ts', type: 'update', diff: '-a\n+b' } as FileChange
const all: UnfoldSettings = { commands: true, changes: true, failures: true, thinking: true }
const none: UnfoldSettings = { commands: false, changes: false, failures: false, thinking: false }

describe('opensByItself', () => {
  it('opens changes and failures, but not commands, by default', () => {
    expect(opensByItself({ tool: 'edit', status: 'done', changes: [change] }, DEFAULT_UNFOLD, false)).toBe(true)
    expect(opensByItself({ tool: 'read', status: 'error' }, DEFAULT_UNFOLD, false)).toBe(true)
    expect(opensByItself({ tool: 'bash', status: 'error' }, DEFAULT_UNFOLD, false)).toBe(true)
    expect(opensByItself({ tool: 'bash', status: 'running' }, DEFAULT_UNFOLD, false)).toBe(false)
    expect(opensByItself({ tool: 'bash', status: 'done' }, DEFAULT_UNFOLD, false)).toBe(false)
  })

  it('opens what the settings say', () => {
    expect(opensByItself({ tool: 'bash', status: 'done' }, all, false)).toBe(true)
    expect(opensByItself({ tool: 'bash', status: 'done' }, none, false)).toBe(false)
    expect(opensByItself({ tool: 'edit', status: 'done', changes: [change] }, none, false)).toBe(false)
    expect(opensByItself({ tool: 'read', status: 'error' }, none, false)).toBe(false)
    // A failed command is a command as well.
    expect(opensByItself({ tool: 'bash', status: 'error' }, { ...none, commands: true }, false)).toBe(true)
  })

  it('keeps reads, searches and tools without changes folded', () => {
    expect(opensByItself({ tool: 'read', status: 'done' }, all, false)).toBe(false)
    expect(opensByItself({ tool: 'search', status: 'done' }, all, false)).toBe(false)
    expect(opensByItself({ tool: 'edit', status: 'running', changes: [] }, all, false)).toBe(false)
  })

  it('folds changes when the computer keeps diffs folded, commands and failures not', () => {
    expect(opensByItself({ tool: 'edit', status: 'done', changes: [change] }, all, true)).toBe(false)
    expect(opensByItself({ tool: 'bash', status: 'done' }, all, true)).toBe(true)
    expect(opensByItself({ tool: 'edit', status: 'error', changes: [change] }, all, true)).toBe(true)
  })
})

describe('groupOpensByItself', () => {
  it('opens a run with something in it that opens by itself', () => {
    expect(groupOpensByItself([{ tool: 'read', status: 'done' }, { tool: 'bash', status: 'done' }], all, false)).toBe(true)
    expect(groupOpensByItself([{ tool: 'read', status: 'done' }, { tool: 'bash', status: 'done' }], DEFAULT_UNFOLD, false)).toBe(false)
    expect(groupOpensByItself([{ tool: 'bash', status: 'done' }, { tool: 'bash', status: 'error' }], DEFAULT_UNFOLD, false)).toBe(true)
    expect(groupOpensByItself([{ tool: 'read', status: 'done' }, { tool: 'search', status: 'done' }], all, false)).toBe(false)
  })

  it('keeps the browser steps folded', () => {
    expect(groupOpensByItself([{ tool: 'other', status: 'error' }], all, false, true)).toBe(false)
  })
})

describe('parseUnfold', () => {
  it('takes what is stored over the defaults', () => {
    expect(parseUnfold({ commands: true, thinking: false })).toEqual({ ...DEFAULT_UNFOLD, commands: true, thinking: false })
  })

  it('keeps the defaults for nothing, broken entries and other values', () => {
    expect(parseUnfold(null)).toEqual(DEFAULT_UNFOLD)
    expect(parseUnfold('commands')).toEqual(DEFAULT_UNFOLD)
    expect(parseUnfold([true])).toEqual(DEFAULT_UNFOLD)
    expect(parseUnfold({ commands: 'yes', changes: 0, other: true })).toEqual(DEFAULT_UNFOLD)
  })

  it('hands out a copy, never the defaults themselves', () => {
    const settings = parseUnfold(null)
    settings.commands = true
    expect(DEFAULT_UNFOLD.commands).toBe(false)
  })
})
