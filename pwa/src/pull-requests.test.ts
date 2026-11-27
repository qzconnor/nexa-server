import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { REFRESH_MS, usePullRequests, webLink } from './pull-requests'
import { FilesInvoke } from './shared/files-ipc'
import type { PullRequestInfo, PullRequestList } from './shared/pull-requests'

const pr = (number: number, branch: string): PullRequestInfo => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  branch,
  base: 'main',
  draft: false,
  review: null,
  checks: null,
  author: 'someone',
  updatedAt: 1000 - number,
})
const listOf = (...pullRequests: PullRequestInfo[]): PullRequestList => ({ ok: true, pullRequests, webUrl: 'https://github.com/o/r', at: 0 })

/** Lets the calls answer and the watchers run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('usePullRequests', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(answers: Record<string, PullRequestList>, branches: Record<string, string | null>, dir = 'C:/repo') {
    const folder = ref<string | null>(dir)
    const visible = ref(true)
    const calls: { ch: string; args: unknown[] }[] = []
    const call = vi.fn(async (ch: string, args: unknown[]) => {
      calls.push({ ch, args })
      const at = args[0] as string
      if (ch === FilesInvoke.gitBranch) return branches[at] === null ? null : { name: branches[at] ?? 'main', detached: false }
      if (ch === FilesInvoke.gitPullRequests) return answers[at] ?? { ok: false, missing: 'no-github' }
      throw new Error(`unexpected ${ch}`)
    })
    const scope = effectScope()
    const state = scope.run(() => usePullRequests({ dir: () => folder.value, call, visible }))!
    return { folder, visible, calls, call, scope, state }
  }

  it('puts the pull request of the checked-out branch first', async () => {
    const { state, scope } = setup({ 'C:/repo': listOf(pr(1, 'a'), pr(2, 'feat'), pr(3, 'b')) }, { 'C:/repo': 'feat' })
    await settle()
    expect(state.pullRequests.value.map((p) => p.number)).toEqual([2, 1, 3])
    expect(state.own.value?.number).toBe(2)
    expect(state.webUrl.value).toBe('https://github.com/o/r')
    scope.stop()
  })

  it('has no own pull request on a branch without one', async () => {
    const { state, scope } = setup({ 'C:/repo': listOf(pr(1, 'a')) }, { 'C:/repo': 'main' })
    await settle()
    expect(state.pullRequests.value).toHaveLength(1)
    expect(state.own.value).toBeNull()
    scope.stop()
  })

  it('shows nothing where the computer finds no repository on GitHub', async () => {
    const { state, scope } = setup({}, {})
    await settle()
    expect(state.list.value).toEqual({ ok: false, missing: 'no-github' })
    expect(state.pullRequests.value).toEqual([])
    scope.stop()
  })

  it('keeps what shows when a call fails on the way', async () => {
    const { state, call, scope } = setup({ 'C:/repo': listOf(pr(1, 'a')) }, {})
    await settle()
    call.mockRejectedValue(new Error('offline'))
    await state.refresh()
    expect(state.pullRequests.value).toHaveLength(1)
    scope.stop()
  })

  it('drops the answer for a folder shown before', async () => {
    const { folder, state, call, scope } = setup({ 'C:/one': listOf(pr(1, 'a')), 'C:/two': listOf(pr(2, 'b')) }, {}, 'C:/one')
    let release!: () => void
    const slow = new Promise<void>((resolve) => (release = resolve))
    const fast = call.getMockImplementation()!
    call.mockImplementation(async (ch, args) => {
      if (args[0] === 'C:/one') await slow
      return fast(ch, args)
    })
    await settle()
    folder.value = 'C:/two'
    await settle()
    release()
    await settle()
    expect(state.pullRequests.value.map((p) => p.number)).toEqual([2])
    scope.stop()
  })

  it('reads again in front, every few minutes, and fresh when asked', async () => {
    const { visible, calls, state, scope } = setup({ 'C:/repo': listOf() }, {})
    await settle()
    const reads = () => calls.filter((c) => c.ch === FilesInvoke.gitPullRequests)
    expect(reads()).toHaveLength(1)

    visible.value = false
    await settle()
    vi.advanceTimersByTime(REFRESH_MS)
    await settle()
    expect(reads()).toHaveLength(1)

    visible.value = true
    await settle()
    expect(reads()).toHaveLength(2)
    vi.advanceTimersByTime(REFRESH_MS)
    await settle()
    expect(reads()).toHaveLength(3)

    await state.refresh(true)
    expect(reads().at(-1)!.args).toEqual(['C:/repo', true])
    scope.stop()
    vi.advanceTimersByTime(REFRESH_MS)
    await settle()
    expect(reads()).toHaveLength(4)
  })

  it('asks nothing without a folder', async () => {
    const { calls, state, scope } = setup({}, {}, '')
    await settle()
    expect(calls).toEqual([])
    expect(state.list.value).toBeNull()
    scope.stop()
  })
})

describe('webLink', () => {
  it('lets only pages on the web through', () => {
    expect(webLink('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1')
    expect(webLink('javascript:alert(1)')).toBeUndefined()
    expect(webLink(null)).toBeUndefined()
  })
})
