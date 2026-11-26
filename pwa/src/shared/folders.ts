/** Trailing separators, except the one of a root like `C:\` or `/`. */
export const TRAILING_SEPARATORS = /(?<=[^\\/:])[\\/]+$/

/** Drive letters and UNC paths: Windows compares them without regard to case and slash. */
const WINDOWS_PATH = /^(?:[a-z]:|\\\\|\/\/)/i

/** `/f/Projekte` (Git Bash) and `/cygdrive/f/Projekte` (Cygwin): how some sessions write a folder on Windows. */
const POSIX_DRIVE = /^\/(?:cygdrive\/)?([a-z])(?=\/|$)/i
const DRIVE = /^[a-z]:/i

/**
 * A folder as Windows writes it: `F:\Projekte` also for `f:/Projekte`, `/f/Projekte` (Git Bash) or
 * `/cygdrive/f/Projekte`, every drive letter upper case. Other paths (UNC, relative) stay as they are.
 * Only for folders on Windows: elsewhere `/f/Projekte` is a folder of its own.
 */
export function windowsPath(path: string): string {
  const trimmed = path.trim()
  const posix = POSIX_DRIVE.exec(trimmed)
  const drive = posix ? `${posix[1]}:${trimmed.slice(posix[0].length) || '\\'}` : trimmed
  if (!DRIVE.test(drive)) return path
  return drive.charAt(0).toUpperCase() + drive.slice(1).replaceAll('/', '\\')
}

/** What a folder is compared by, so `F:\Code\` and `f:/code` count as one. */
export function folderKey(path: string): string {
  const trimmed = path.trim().replace(TRAILING_SEPARATORS, '')
  return WINDOWS_PATH.test(trimmed) ? trimmed.replaceAll('/', '\\').toLowerCase() : trimmed
}

/** Whether `path` is the folder `folder` or lies in it, compared by `folderKey`. */
export function inFolder(path: string, folder: string): boolean {
  const a = folderKey(path)
  const b = folderKey(folder)
  if (!b) return false
  if (a === b) return true
  const separator = WINDOWS_PATH.test(b) ? '\\' : '/'
  return a.startsWith(b.endsWith(separator) ? b : `${b}${separator}`)
}

/** The parts of a path, without empty ones: `C:\a\b` → `C:`, `a`, `b`; `/home/me` → `home`, `me`. */
export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

/** The innermost of `folders` that `path` lies in (or is), as in the Claude Manager's workspaces; undefined outside all. */
export function innermostFolder<T>(path: string, folders: readonly T[], pathOf: (folder: T) => string): T | undefined {
  let best: T | undefined
  let depth = -1
  for (const folder of folders) {
    const own = pathOf(folder)
    if (!inFolder(path, own)) continue
    const segments = pathSegments(folderKey(own)).length
    if (segments > depth) {
      best = folder
      depth = segments
    }
  }
  return best
}

/** The folders between `folder` and `path` in it, as `path` writes them: `F:\a`, `F:\a\b\c` → `b`, `c`. Empty for the folder itself or outside it. */
export function subfolderSegments(path: string, folder: string): string[] {
  if (!inFolder(path, folder)) return []
  return pathSegments(path).slice(pathSegments(folderKey(folder)).length)
}

/** The folder `name` in `folder`, with the separator `folder` writes: a Windows path stays one on any system. */
export function childFolder(folder: string, name: string): string {
  const trimmed = folder.trim().replace(TRAILING_SEPARATORS, '')
  const separator = trimmed.includes('\\') || DRIVE.test(trimmed) ? '\\' : '/'
  return trimmed.endsWith(separator) ? `${trimmed}${name}` : `${trimmed}${separator}${name}`
}

/** The folder `path` lies in, as `path` writes it; null for a root like `C:\` or `/`. */
export function parentFolder(path: string): string | null {
  const trimmed = path.trim().replace(TRAILING_SEPARATORS, '')
  const at = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (at < 0 || at === trimmed.length - 1) return null
  const parent = trimmed.slice(0, at)
  // Empty and `C:` are the roots themselves: `/` and `C:\`.
  if (parent === '') return '/'
  return DRIVE.test(parent) && parent.length === 2 ? `${parent}\\` : parent
}

/**
 * A path as short as it stays clear: `~` for the home folder at its start (`~\Projekte\app`). Paths
 * outside it stay as they are.
 */
export function shortenPath(path: string, home: string | null | undefined): string {
  if (!home || !inFolder(path, home)) return path
  const rest = subfolderSegments(path, home)
  const separator = path.includes('\\') || DRIVE.test(path) ? '\\' : '/'
  return rest.length ? `~${separator}${rest.join(separator)}` : '~'
}

/**
 * Where `path` is once the folder `from` it lies in (or is) has moved to `to`, with the separators of
 * `to`; null when it doesn't lie in `from`.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  if (!inFolder(path, from)) return null
  // Spelled differently maybe, but as long: `folderKey` changes neither the length nor the separators' places.
  const rest = path.trim().replace(TRAILING_SEPARATORS, '').slice(from.trim().replace(TRAILING_SEPARATORS, '').length)
  const parts = rest.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0) return to
  const separator = to.includes('\\') || DRIVE.test(to) ? '\\' : '/'
  return `${to.replace(/[\\/]+$/, '')}${separator}${parts.join(separator)}`
}
