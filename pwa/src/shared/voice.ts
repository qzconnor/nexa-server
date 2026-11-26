import { visibleAccounts, type Account } from './accounts'
import type { Unsubscribe } from './ipc'

/**
 * Voice input in the composer: the window records the microphone, the main process streams it to
 * Claude's speech recognition (the one behind Claude Code's `/voice`) with the OAuth token of a Claude
 * account, and the text comes back while one speaks. It goes into the composer like typed text, so it
 * works the same for every CLI. Always through Claude: without a Claude login there is no voice input
 * (Codex' own `/voice` is a spoken conversation, not dictation). Protocol: docs/PROTOCOLS.md, „Spracheingabe“.
 */

/**
 * The Claude accounts to try, in order: the one set, and only it; else (also when it was removed)
 * the chat's, then those the user sees, then the others. API keys have no login for the recognition.
 */
export function voiceCandidates<T extends Pick<Account, 'id' | 'provider' | 'kind'>>(accounts: readonly T[], setting: string, chatAccount?: string): T[] {
  const claude = accounts.filter((a) => a.provider === 'claude' && a.kind !== 'apiKey')
  const chosen = claude.filter((a) => a.id === setting)
  if (chosen.length) return chosen
  const order = [...claude.filter((a) => a.id === chatAccount), ...visibleAccounts(claude, 'claude'), ...claude]
  return [...new Set(order)]
}

/**
 * Whether the composer offers the microphone: Claude is switched on in Nexa and one of the accounts
 * to try is signed in. An expired login still counts: Claude Code renews it with its next start, and
 * until then the take says so.
 */
export function voiceAvailable(
  accounts: readonly Pick<Account, 'id' | 'provider' | 'kind' | 'authState'>[],
  setting: string,
  claudeEnabled: boolean,
): boolean {
  return claudeEnabled && voiceCandidates(accounts, setting).some((a) => a.authState === 'ok' || a.authState === 'expired')
}

/** Request/response channels (ipcRenderer.invoke ↔ ipcMain.handle). */
export const VoiceInvoke = {
  start: 'voice:start',
  audio: 'voice:audio',
  stop: 'voice:stop',
  cancel: 'voice:cancel',
} as const

/** Main → window. */
export const VoiceEvent = {
  event: 'voice:event',
} as const

/** What the recognition wants: 16-bit little-endian PCM, mono, 16 kHz. */
export const VOICE_SAMPLE_RATE = 16_000

/** The languages Claude's speech recognition takes (as Claude Code lists them), with their German names. */
export const VOICE_LANGUAGES = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'Englisch' },
  { code: 'fr', label: 'Französisch' },
  { code: 'es', label: 'Spanisch' },
  { code: 'it', label: 'Italienisch' },
  { code: 'pt', label: 'Portugiesisch' },
  { code: 'nl', label: 'Niederländisch' },
  { code: 'pl', label: 'Polnisch' },
  { code: 'cs', label: 'Tschechisch' },
  { code: 'da', label: 'Dänisch' },
  { code: 'sv', label: 'Schwedisch' },
  { code: 'no', label: 'Norwegisch' },
  { code: 'el', label: 'Griechisch' },
  { code: 'tr', label: 'Türkisch' },
  { code: 'ru', label: 'Russisch' },
  { code: 'uk', label: 'Ukrainisch' },
  { code: 'hi', label: 'Hindi' },
  { code: 'id', label: 'Indonesisch' },
  { code: 'ja', label: 'Japanisch' },
  { code: 'ko', label: 'Koreanisch' },
] as const

const CODES = new Set<string>(VOICE_LANGUAGES.map((l) => l.code))

/**
 * The language to recognise: the one set (`''` for the system's), else the system's own (`de-DE` →
 * `de`), else English, as Claude Code falls back.
 */
export function voiceLanguage(setting: string, locale: string): string {
  for (const candidate of [setting, locale]) {
    const code = candidate.trim().toLowerCase().split(/[-_]/)[0] ?? ''
    if (CODES.has(code)) return code
  }
  return 'en'
}

export function voiceLanguageLabel(code: string): string {
  return VOICE_LANGUAGES.find((l) => l.code === code)?.label ?? code
}

export interface VoiceStartInput {
  /** The chat's account: a Claude account goes first when the setting says „automatisch“. */
  account?: string
  /** Words the recognition should expect (the project's name and the like). */
  keyterms?: string[]
}

/**
 * What the recognition heard. `final: false` is the utterance so far, each one replacing the one
 * before; `final: true` closes it, and the next utterance starts from nothing.
 */
export type VoiceUpdate =
  | { type: 'transcript'; text: string; final: boolean }
  /** The take failed; the session is over. */
  | { type: 'error'; message: string }

export interface VoiceApi {
  /** Opens a session with a Claude account's login; throws when none can be used. Returns its id. */
  start: (input: VoiceStartInput) => Promise<string>
  /** A piece of the recording (16-bit PCM, mono, 16 kHz). */
  audio: (id: string, chunk: Uint8Array) => Promise<void>
  /** The recording is over: resolves once the last words came (as updates before it). */
  stop: (id: string) => Promise<void>
  /** Ends the session without waiting for anything. */
  cancel: (id: string) => Promise<void>
  onUpdate: (cb: (id: string, update: VoiceUpdate) => void) => Unsubscribe
}

/** One message of the recognition as Nexa uses it; null for those it ignores (or can't read). */
export type VoiceServerMessage =
  | { kind: 'text'; text: string }
  | { kind: 'endpoint' }
  | { kind: 'error'; message: string }

export function parseVoiceMessage(raw: string): VoiceServerMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  switch (message.type) {
    case 'TranscriptText':
    case 'TranscriptInterim':
      return typeof message.data === 'string' && message.data ? { kind: 'text', text: message.data } : null
    case 'TranscriptEndpoint':
      return { kind: 'endpoint' }
    case 'TranscriptError':
      return { kind: 'error', message: str(message.description) ?? str(message.error_code) ?? 'unbekannter Fehler' }
    case 'error':
      return { kind: 'error', message: str(message.message) ?? 'unbekannter Fehler' }
    default:
      return null
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Keyterms as the recognition takes them: printable, without commas, each once, at most 1024 characters in all. */
export function voiceKeyterms(terms: readonly string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  let length = 0
  for (const term of terms) {
    const clean = term
      .replace(/,/g, ' ')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!clean || seen.has(clean)) continue
    const add = clean.length + (out.length ? 1 : 0)
    if (length + add > 1024) break
    seen.add(clean)
    out.push(clean)
    length += add
  }
  return out.join(',')
}
