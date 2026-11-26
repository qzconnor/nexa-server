import { PROVIDER_IDS, type PermissionMode, type ProviderId } from './chat'
import type { AppSettings, DeepPartial } from './types'

/**
 * What Nexa knows of each CLI without asking it. The models come from the CLI itself at runtime
 * (Claude: `initialize`, Codex: `model/list`); these are only shown until it answered.
 *
 * A further CLI: an id in `ProviderId`, an entry here, and a provider in `src/main/providers/<id>`
 * that implements `AgentProvider` (see docs/ARCHITECTURE.md).
 */
export interface ProviderMeta {
  id: ProviderId
  name: string
  short: string
  command: string
  /** Where to get the CLI. */
  installUrl: string
  /** The command that installs it; on Windows, unless `installHintPosix` names another for macOS and Linux. */
  installHint: string
  installHintPosix?: string
  loginCommand: string
  /** Its browser login always ends with a code the page shows, to paste into Nexa (no callback). */
  loginCode?: boolean
  /** Nexa can sign its accounts out (Settings › Accounts). */
  signOut?: boolean
  permissionModes: PermissionMode[]
  /**
   * Offered for chats only once Nexa found it (Settings › CLIs shows it always, with how to install it).
   * A CLI few users have would otherwise sit in every chat's picker as „nicht installiert“.
   */
  untilInstalled?: boolean
  /** Its name in the switchers of the settings, when people know it by another (Gemini). Else `short`. */
  settingsLabel?: string
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'Claude',
    command: 'claude',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    installHint: 'irm https://claude.ai/install.ps1 | iex',
    loginCommand: 'claude auth login',
    permissionModes: ['ask', 'edits', 'plan', 'auto', 'full'],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    short: 'Codex',
    command: 'codex',
    installUrl: 'https://github.com/openai/codex',
    installHint: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    permissionModes: ['ask', 'edits', 'plan', 'full'],
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity CLI',
    short: 'Antigravity',
    command: 'agy',
    installUrl: 'https://antigravity.google/product/antigravity-cli',
    installHint: 'irm https://antigravity.google/cli/install.ps1 | iex',
    installHintPosix: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    loginCommand: 'agy acp --login',
    loginCode: true,
    signOut: true,
    permissionModes: ['ask', 'edits', 'plan', 'auto', 'full'],
    untilInstalled: true,
    // It follows Gemini CLI and runs Google's Gemini models; in the settings both names help find it.
    settingsLabel: 'Gemini / Antigravity',
  },
}

export const PERMISSION_MODES: Record<PermissionMode, { label: string; description: string }> = {
  ask: { label: 'Nachfragen', description: 'Fragt vor Änderungen und Befehlen' },
  edits: { label: 'Bearbeiten erlauben', description: 'Ändert Dateien ohne Nachfrage, fragt vor Befehlen' },
  plan: { label: 'Planen', description: 'Liest nur und schlägt einen Plan vor' },
  auto: { label: 'Auto', description: 'Ein Klassifikator entscheidet über Freigaben' },
  full: { label: 'Volle Rechte', description: 'Alles ohne Nachfrage – nur in vertrauten Ordnern' },
}

export function providerName(id: ProviderId): string {
  return PROVIDERS[id].name
}

type ProviderToggles = Pick<AppSettings, ProviderId | 'defaults'>

/** The CLIs switched on in the settings, in their order. */
export function enabledProviders(settings: Pick<AppSettings, ProviderId>): ProviderId[] {
  return PROVIDER_IDS.filter((id) => settings[id].enabled)
}

/** The CLIs that are on and offered to choose from: one with `untilInstalled` only once it was found. */
export function offeredProviders(settings: Pick<AppSettings, ProviderId>, installed: readonly ProviderId[]): ProviderId[] {
  return enabledProviders(settings).filter((id) => !PROVIDERS[id].untilInstalled || installed.includes(id))
}

/**
 * The settings change that switches a CLI on or off. New chats can't start with one that is off, so
 * the default moves to one that is on. The last one stays on: without a CLI Nexa can do nothing.
 */
export function providerTogglePatch(settings: ProviderToggles, id: ProviderId, enabled: boolean): DeepPartial<AppSettings> | null {
  if (settings[id].enabled === enabled) return null
  const others = enabledProviders(settings).filter((other) => other !== id)
  if (!enabled && !others.length) return null
  const patch: DeepPartial<AppSettings> = { [id]: { enabled } }
  if (!enabled && settings.defaults.provider === id) patch.defaults = { provider: others[0] }
  return patch
}
