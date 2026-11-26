/**
 * Spell checking in Nexa's text fields (Einstellungen › Chat › Eingabe): Chromium's spellchecker, with
 * its suggestions in the menu of a right click (main/window/edit-menu.ts). On macOS the system's own
 * checks, in the languages macOS has set.
 */

/** A language code as the spellchecker names them (`de`, `de-DE`, `en-GB-oxendict`). */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/

export function isLanguageCode(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGE_CODE.test(value)
}

/** At most this many languages: each one is a dictionary in memory, and every word is looked up in all. */
export const MAX_SPELLCHECK_LANGUAGES = 6

/**
 * The languages the spellchecker gets: the chosen ones, or with none chosen the system's and English
 * (prompts mix in English words: commit, branch, deploy). Each as one the spellchecker has
 * (`available`): exactly, else the same language of another region, else left out; it refuses codes it
 * doesn't have.
 */
export function spellcheckLanguages(chosen: readonly string[], system: readonly string[], available: readonly string[]): string[] {
  const wanted = chosen.length ? chosen : [system[0] ?? 'en-US', 'en-US']
  const out: string[] = []
  for (const code of wanted) {
    const match = matchLanguage(code, available)
    if (match && !out.includes(match)) out.push(match)
    if (out.length === MAX_SPELLCHECK_LANGUAGES) break
  }
  return out
}

function matchLanguage(code: string, available: readonly string[]): string | null {
  const find = (wanted: string) => available.find((a) => a.toLowerCase() === wanted.toLowerCase())
  const base = code.split('-')[0]!.toLowerCase()
  // `de-AT` → `de`; `de` → `de-DE`, `en` → `en-US`; else the first region there is (`pt` → `pt-BR` without `pt-PT`).
  return (
    find(code) ??
    find(base) ??
    find(`${base}-${base === 'en' ? 'US' : base.toUpperCase()}`) ??
    available.find((a) => a.toLowerCase().startsWith(`${base}-`)) ??
    null
  )
}

const names = new Intl.DisplayNames(['de'], { type: 'language' })

/** „Deutsch (Deutschland)“, „Englisch (Vereinigte Staaten)“; the code itself where there is no name. */
export function languageName(code: string): string {
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}

/** „Deutsch, Englisch“: each by the language alone, with its region where the language is there twice (`en-GB`, `en-US`). */
export function shortLanguageNames(codes: readonly string[]): string[] {
  const base = (code: string) => code.split('-')[0]!
  return codes.map((code) => languageName(codes.filter((c) => base(c) === base(code)).length > 1 ? code : base(code)))
}
