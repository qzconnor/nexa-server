import { onBeforeUnmount, shallowRef, watchEffect } from 'vue'

/** The computer a page is about, as the header shows it on its right. */
export interface PageComputer {
  name: string
  /** Its dot, a bg-* class: online, offline, not yet a member. */
  dot: string
  /** The dot turns into a spinner: an answer is on its way. */
  busy?: boolean
  /** What it allows or why it can't be used, for a tooltip and screen readers. */
  hint?: string
  /** There are others: the header lets one pick another (ComputerMenu.vue). */
  switchable?: boolean
}

/** The plan limits that count for a chat, on the right of its header: a ring per window. */
export interface PageLimits {
  windows: { key: string; short: string; label: string; percent: number }[]
  /** The CLI refuses work until a reset. */
  limited: boolean
}

/** What a page puts into the header: its own title (a chat's) over the route's, the computer it is about, a chat's limits. */
export interface PageTitle {
  text?: string
  computer?: PageComputer
  limits?: PageLimits | null
}

export const pageTitle = shallowRef<(PageTitle & { owner: symbol }) | null>(null)

/**
 * Sets the header's title while the page is mounted. The page that comes next sets its own before
 * this one unmounts, so only the owner clears it.
 */
export function usePageTitle(title: () => string | PageTitle | null | undefined): void {
  const owner = Symbol('page')
  watchEffect(() => {
    const value = title()
    if (value) pageTitle.value = { owner, ...(typeof value === 'string' ? { text: value } : value) }
    else if (pageTitle.value?.owner === owner) pageTitle.value = null
  })
  onBeforeUnmount(() => {
    if (pageTitle.value?.owner === owner) pageTitle.value = null
  })
}
