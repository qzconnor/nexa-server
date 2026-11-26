import { onBeforeUnmount, shallowRef, watchEffect } from 'vue'

/** A title a page gives itself (a chat's, a computer's name), over the one of its route. */
export const pageTitle = shallowRef<{ owner: symbol; text: string } | null>(null)

/**
 * Sets the header's title while the page is mounted. The page that comes next sets its own before
 * this one unmounts, so only the owner clears it.
 */
export function usePageTitle(text: () => string | null | undefined): void {
  const owner = Symbol('page')
  watchEffect(() => {
    const value = text()
    if (value) pageTitle.value = { owner, text: value }
    else if (pageTitle.value?.owner === owner) pageTitle.value = null
  })
  onBeforeUnmount(() => {
    if (pageTitle.value?.owner === owner) pageTitle.value = null
  })
}
