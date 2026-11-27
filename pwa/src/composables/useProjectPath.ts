// The PWA of nexa-server copies this file byte for byte: imports only from `@shared/…` and `vue`, no Node
// APIs (main/server-link/pwa-copies.test.ts).
import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'

const KEY: InjectionKey<ComputedRef<string | null>> = Symbol('project-path')

/** The chat's project folder, for what is shown inside it (ChatView provides it). */
export function provideProjectPath(path: ComputedRef<string | null>): void {
  provide(KEY, path)
}

/** A path inside the project as it is relative to it; others stay as they are. */
export function relativeTo(path: string, root: string | null | undefined): string {
  if (!root) return path
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = norm(root)
  const target = norm(path)
  const windows = /^[a-z]:\//i.test(base)
  const same = windows ? target.toLowerCase().startsWith(base.toLowerCase() + '/') : target.startsWith(base + '/')
  return same ? target.slice(base.length + 1) : path
}

/** Shortens paths of the project's folder in a text (a command line, a path). */
export function shortenIn(text: string, root: string | null | undefined): string {
  if (!root || !text) return text
  const variants = [root, root.replace(/\\/g, '/'), root.replace(/\\/g, '\\\\')]
  let out = text
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`${escaped}[\\\\/]+`, 'gi'), '')
  }
  return out
}

export function useProjectPath() {
  const root = inject(KEY, computed(() => null))
  return {
    root,
    relative: (path: string) => relativeTo(path, root.value),
    shorten: (text: string) => shortenIn(text, root.value),
  }
}
