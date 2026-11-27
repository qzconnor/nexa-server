import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { sortForBranch } from './lib/pull-requests'
import type { GitBranch } from './shared/files'
import { FilesInvoke } from './shared/files-ipc'
import type { PullRequestInfo, PullRequestList } from './shared/pull-requests'

/** Read again this often while the page is in front: checks finish and reviews come without anything here changing. */
export const REFRESH_MS = 3 * 60_000

export interface PullRequestsOptions {
  /** The chat's folder on the computer; nothing without one. */
  dir: () => string | null | undefined
  /** A call of the computer's window API (`host.call`). */
  call: (ch: string, args: unknown[]) => Promise<unknown>
  /** The page is in front (visibility.ts); hidden, nothing is read. */
  visible: Readonly<Ref<boolean>>
}

/**
 * The open pull requests of the repository a chat's folder lies in, as the computer reads them with its
 * GitHub CLI (`git:pull-requests`), and its checked-out branch (`git:branch`), whose pull request comes
 * first: as `usePullRequests` of the app. Read when the folder changes, when the page comes to the front
 * and every few minutes while it is; `refresh(true)` after a turn, in which the agent may have opened one
 * (the computer keeps its answer a minute otherwise). A computer without the channel, a call that fails
 * on the way keep what shows; an answer for a folder shown before comes too late.
 */
export function usePullRequests({ dir, call, visible }: PullRequestsOptions) {
  const list = shallowRef<PullRequestList | null>(null)
  /** The checked-out branch; null for a detached HEAD, outside a repository and while loading. */
  const branch = ref<string | null>(null)
  const loading = ref(false)
  let loads = 0

  async function refresh(fresh = false): Promise<void> {
    const current = dir()
    const id = ++loads
    if (!current) {
      list.value = null
      branch.value = null
      loading.value = false
      return
    }
    loading.value = true
    const [head, answer] = await Promise.allSettled([call(FilesInvoke.gitBranch, [current]), call(FilesInvoke.gitPullRequests, [current, fresh])])
    if (id !== loads) return
    loading.value = false
    if (head.status === 'fulfilled') {
      const value = head.value as GitBranch | null
      branch.value = value && !value.detached ? value.name : null
    }
    if (answer.status === 'fulfilled' && isList(answer.value)) list.value = answer.value
  }

  watch(
    dir,
    (next, before) => {
      // Another folder: its list, not the last one's, once it comes.
      if (next !== before) {
        list.value = null
        branch.value = null
      }
      void refresh()
    },
    { immediate: true },
  )
  watch(visible, (now) => {
    if (now) void refresh()
  })
  const timer = setInterval(() => {
    if (visible.value) void refresh()
  }, REFRESH_MS)
  onScopeDispose(() => {
    clearInterval(timer)
    // Whatever is still out answers no one.
    loads++
  })

  const pullRequests = computed<PullRequestInfo[]>(() => (list.value?.ok ? sortForBranch(list.value.pullRequests, branch.value) : []))
  /** The pull request of the checked-out branch, if it has an open one. */
  const own = computed(() => (branch.value ? (pullRequests.value.find((pr) => pr.branch === branch.value) ?? null) : null))
  const webUrl = computed(() => (list.value?.ok ? list.value.webUrl : null))

  return { list, pullRequests, own, branch, webUrl, loading, refresh }
}

function isList(value: unknown): value is PullRequestList {
  if (!value || typeof value !== 'object') return false
  const list = value as { ok?: unknown; pullRequests?: unknown }
  return list.ok === false || (list.ok === true && Array.isArray(list.pullRequests))
}

/** Only pages on the web open from the chip: what the computer hands over is no script. */
export function webLink(url: string | null | undefined): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}
