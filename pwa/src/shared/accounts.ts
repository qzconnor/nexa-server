import type { ProviderId } from './chat'

/**
 * Accounts: several logins per CLI side by side, as in the Claude Manager. Every account has its
 * own config folder (CLAUDE_CONFIG_DIR, CODEX_HOME, Antigravity's `--gemini-dir`) with its login,
 * settings and conversations; the standard account of a CLI is its own folder (`~/.claude`,
 * `~/.codex`, `~/.gemini`).
 *
 * - `system`: the CLI's own folder, as without Nexa.
 * - `oauth`: a folder of its own, signed in through the browser (`claude auth login`, `codex login`,
 *   `agy acp --login` with the login in the folder instead of the keyring).
 * - `token`: Claude Code with a long-lived token from `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN).
 * - `apiKey`: Claude Code with an Anthropic API key (ANTHROPIC_API_KEY), Antigravity CLI with a Gemini
 *   API key (GEMINI_API_KEY).
 */
export type AccountKind = 'system' | 'oauth' | 'token' | 'apiKey'

/** `expired`: the access token ran out but renews at the next start; `dead`: a new login is needed. */
export type AuthState = 'ok' | 'expired' | 'dead' | 'missing'

/** Who is signed in, as far as the account's files tell. */
export interface AccountIdentity {
  email: string | null
  displayName: string | null
  organizationName: string | null
  /** e.g. `claude_max`, `chatgpt_plus` */
  organizationType: string | null
  /** The plan: `max`, `pro`, `plus` … */
  subscriptionType: string | null
}

export interface Account {
  id: string
  name: string
  provider: ProviderId
  kind: AccountKind
  /** `#rrggbb`, the dot next to its name everywhere. */
  color: string
  /** The folder the CLI runs with (CLAUDE_CONFIG_DIR, CODEX_HOME). */
  configDir: string
  /** The folder is the user's (the CLI's own or one they picked): Nexa never deletes it. */
  customConfigDir: boolean
  createdAt: number
  /** Start and end of the stored token or key, e.g. `sk-ant-oat…x7Qa`. */
  secretHint: string | null
  authState: AuthState
  identity: AccountIdentity
  /** When the access token runs out (ISO); the CLI renews it with its refresh token. */
  tokenExpiresAt: string | null
  /** When the browser login itself ends (its refresh token runs out, Claude only): then only signing in again helps. */
  loginEndsAt: string | null
  /** When the CLI or Nexa last saved the tokens of the browser login (signed in or renewed). */
  tokenSavedAt: string | null
  /** The browser login has a refresh token that may still work (else `dead` once the access token runs out). */
  renewable: boolean
  /** Appended to every start of the CLI with this account. */
  extraArgs: string[]
}

export type CreatableAccountKind = Exclude<AccountKind, 'system'>

export interface AccountCreateInput {
  provider: ProviderId
  kind: CreatableAccountKind
  name: string
  color?: string
  /** Token or API key (kinds `token` and `apiKey`). */
  secret?: string
  /** An existing config folder to use instead of a new one. */
  configDir?: string | null
  /** Copies settings, instructions, skills … from the CLI's own folder into the new one. */
  importSettings?: boolean
  extraArgs?: string[]
}

export interface AccountUpdateInput {
  name?: string
  color?: string
  /** A new token or API key; empty keeps the stored one. */
  secret?: string
  extraArgs?: string[]
}

/**
 * What renewing a Claude login did: `renewed` (a valid access token is saved now, by Nexa or by Claude
 * Code meanwhile), `busy` (Claude Code renews it right now), `rejected` (only signing in again helps) or
 * `failed` (network or server, worth another try).
 */
export type LoginRenewResult = 'renewed' | 'busy' | 'rejected' | 'failed'

/** The browser login of an account, while it runs and how it ended. */
export interface AccountLoginState {
  accountId: string
  status: 'starting' | 'waiting' | 'success' | 'failed' | 'cancelled'
  /** The address of the login page, once the CLI named it (it opens the browser itself). */
  url: string | null
  /** Why it failed, from the CLI's output. */
  message: string | null
  /** The CLI takes a code pasted from the browser (when its callback can't be reached). */
  acceptsCode: boolean
}

export const ACCOUNT_COLORS = ['#d97757', '#7aa2f7', '#9ece6a', '#bb9af7', '#e0af68', '#7dcfff', '#f7768e', '#2dd4bf']

/** The kinds of accounts each CLI can have besides its standard account. */
export const ACCOUNT_KINDS: Record<ProviderId, CreatableAccountKind[]> = {
  claude: ['oauth', 'token', 'apiKey'],
  // A ChatGPT login only: an API key bills by use and has no plan limits to switch between.
  codex: ['oauth'],
  // The keyring holds one Google login per user; further ones keep theirs in their folder.
  antigravity: ['oauth', 'apiKey'],
}

/** The fixed id of a CLI's standard account. */
export function systemAccountId(provider: ProviderId): string {
  return provider === 'claude' ? 'system' : `system-${provider}`
}

export function isSystemAccountId(id: string): boolean {
  return id === 'system' || id.startsWith('system-')
}

/**
 * The accounts of a CLI as the user sees and picks them: its standard account only while no other
 * was added. Once the user has their own, the standard one (`~/.claude`, `~/.codex`) is out of the way
 * everywhere: not listed, not chosen, not run with.
 */
export function visibleAccounts<T extends Pick<Account, 'provider' | 'kind'>>(list: readonly T[], provider: ProviderId): T[] {
  const own = list.filter((a) => a.provider === provider)
  const added = own.filter((a) => a.kind !== 'system')
  return added.length ? added : own
}

/** The account a CLI runs with: the first of `candidates` that is visible, else the first visible one. */
export function pickAccount(
  list: readonly Pick<Account, 'id' | 'provider' | 'kind'>[],
  provider: ProviderId,
  candidates: readonly (string | null | undefined)[],
): string {
  const shown = visibleAccounts(list, provider)
  for (const candidate of candidates) {
    if (candidate && shown.some((a) => a.id === candidate)) return candidate
  }
  return shown[0]?.id ?? systemAccountId(provider)
}

/**
 * `list` with the accounts named in `ids` in that order, in the places they took: one CLI's list is
 * sorted without moving the other's, and unnamed accounts (a hidden standard one) stay where they are.
 */
export function reorderAccounts<T extends { id: string }>(list: readonly T[], ids: readonly string[]): T[] {
  const named = new Set(ids)
  const sorted = [...named].map((id) => list.find((a) => a.id === id)).filter((a): a is T => !!a)
  let next = 0
  return list.map((a) => (named.has(a.id) ? sorted[next++]! : a))
}

type LoginOf = Pick<Account, 'provider' | 'identity'>

/**
 * Signed in as the same person in the same organisation: one login in two config folders, e.g. an
 * account taken over from the Claude Manager next to one made in Nexa. Logins without an email never match.
 */
export function sameLogin(a: LoginOf, b: LoginOf): boolean {
  const email = a.identity.email?.toLowerCase()
  return (
    a.provider === b.provider &&
    !!email &&
    email === b.identity.email?.toLowerCase() &&
    (a.identity.organizationName?.toLowerCase() ?? null) === (b.identity.organizationName?.toLowerCase() ?? null)
  )
}

/**
 * The account an added one doubles: the oldest other added account with the same login, made before
 * it. The standard account never counts (it is out of sight once others are there).
 */
export function duplicateOf<T extends Pick<Account, 'id' | 'kind' | 'createdAt'> & LoginOf>(list: readonly T[], account: T): T | null {
  if (account.kind === 'system') return null
  const at = list.indexOf(account)
  const earlier = (other: T) => other.createdAt < account.createdAt || (other.createdAt === account.createdAt && list.indexOf(other) < at)
  const twins = list.filter((other) => other !== account && other.kind !== 'system' && earlier(other) && sameLogin(other, account))
  return twins.sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
}

/** Tokens and API keys can be lent to another config folder; a browser login only works in its own. */
export function usesSecret(kind: AccountKind): boolean {
  return kind === 'token' || kind === 'apiKey'
}

/** A browser login that the account itself can renew (`claude auth login`, `codex login`). */
export function canLogin(kind: AccountKind): boolean {
  return kind === 'system' || kind === 'oauth'
}

/**
 * A browser login Nexa renews itself (`main/accounts/login-renewal.ts`): Claude's, under Claude Code's
 * lock. Codex renews its own when it starts; Nexa leaves its `auth.json` alone.
 */
export function nexaRenewsLogin(account: Pick<Account, 'provider' | 'kind'>): boolean {
  return account.provider === 'claude' && canLogin(account.kind)
}

const SYSTEM_FOLDERS: Record<ProviderId, string> = { claude: '~/.claude', codex: '~/.codex', antigravity: '~/.gemini' }
const BROWSER_LOGINS: Record<ProviderId, string> = { claude: 'Browser-Login', codex: 'ChatGPT-Login', antigravity: 'Google-Login' }

export function accountKindLabel(kind: AccountKind, provider: ProviderId): string {
  if (kind === 'system') return `Standard (${SYSTEM_FOLDERS[provider]})`
  if (kind === 'oauth') return BROWSER_LOGINS[provider]
  if (kind === 'token') return 'Long-lived Token'
  return 'API-Key'
}

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  plus: 'Plus',
  max: 'Max',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
}

/** „Max“, „Plus“ … for a plan as the CLIs name it. */
export function planLabel(plan: string | null | undefined): string | null {
  if (!plan) return null
  const key = plan.toLowerCase().replace(/^(claude|chatgpt)_/, '')
  return PLAN_NAMES[key] ?? plan.charAt(0).toUpperCase() + plan.slice(1)
}

/** „name@firma.de · Firma“, or what is known of it. */
export function identityLabel(identity: AccountIdentity): string | null {
  const organization = identity.organizationName && !/'s Organi[sz]ation$/i.test(identity.organizationName) ? identity.organizationName : null
  const parts = [identity.email ?? identity.displayName, organization].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** `sk-ant-oat01-abc…wxyz`: enough to recognize a secret, too little to use it. */
export function maskSecret(secret: string): string {
  const s = secret.trim()
  if (s.length <= 16) return `${s.slice(0, 4)}…`
  return `${s.slice(0, 12)}…${s.slice(-4)}`
}
