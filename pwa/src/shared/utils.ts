export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether two values hold the same data: plain objects, arrays and primitives, compared all the way down. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameData(item, b[i]))
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
}

/**
 * Recursively merges `patch` into `base` and returns a new object.
 * Arrays and primitives in `patch` replace the value in `base`; `undefined` is ignored.
 * Keys that don't exist in `base` are dropped, so stale or unknown settings never leak in.
 */
export function mergeKnown<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return base
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(base)) {
    if (!(key in patch)) continue
    const next = patch[key]
    const current = (base as Record<string, unknown>)[key]
    if (next === undefined) continue
    if (isPlainObject(current)) {
      out[key] = mergeKnown(current, next)
    } else if (Array.isArray(current)) {
      if (Array.isArray(next)) out[key] = [...next]
    } else if (current === null || next === null || typeof next === typeof current) {
      out[key] = next
    }
  }
  return out as T
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

/** The first line of a text, cut to `max` characters with an ellipsis. */
export function firstLine(text: string, max = 80): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** Rejects when `promise` takes longer than `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = 'Zeitüberschreitung'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** The last segment of a path, for Windows and POSIX separators. */
export function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Lower case for searching; keeps the length, so positions found also hold in the original text. */
export function foldCase(text: string): string {
  return text.replaceAll('İ', 'i').toLowerCase()
}

/** The words of a search query in lower case; a match has to contain every one of them. */
export function searchTerms(query: string): string[] {
  return [...new Set(foldCase(query).split(/\s+/).filter(Boolean))].slice(0, 8)
}
