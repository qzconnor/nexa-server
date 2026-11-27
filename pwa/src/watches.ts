import type { RemoteWatch } from './shared/remote-ipc'

/**
 * The computers watched, as several parts of the page ask: the chats tab its computer with the chats
 * open, the inbox every computer it lists. The client takes one list for all (`setWatch`), and joins
 * the ids of the same computer itself.
 */
export function createWatches(setWatch: (list: readonly RemoteWatch[]) => void) {
  const parts = new Map<string, readonly RemoteWatch[]>()

  return {
    /** What `owner` watches now, in place of what it watched before. */
    set(owner: string, list: readonly RemoteWatch[]): void {
      if (list.length) parts.set(owner, list)
      else parts.delete(owner)
      setWatch([...parts.values()].flat())
    },
  }
}
