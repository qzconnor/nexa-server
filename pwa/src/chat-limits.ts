import { host } from './host'
import { clampPercent, chosenModel, shortWindowLabels, windowsOfModel } from './lib/usage'
import type { PageLimits } from './page-title'
import { pickAccount, systemAccountId } from './shared/accounts'
import type { SessionMeta } from './shared/types'

/** The account a chat runs with, as the computer picks it (the app's stores/accounts.ts `sessionAccount`). */
export function chatAccount(meta: SessionMeta): string {
  const { limits } = host
  const link = meta.cli[meta.provider]
  const chosen = meta.accounts?.[meta.provider] ?? (link ? (link.accountId ?? systemAccountId(meta.provider)) : undefined)
  return pickAccount(limits.accounts, meta.provider, [chosen, limits.defaults[meta.provider]])
}

/**
 * The plan limits that count for a chat, as the app's title bar shows them: those of the account it runs
 * with, for its model, two windows at most. Null while the computer hasn't said, or has no limits for
 * that account.
 */
export function chatLimits(meta: SessionMeta): PageLimits | null {
  const { limits } = host
  if (!limits.loaded) return null
  const account = chatAccount(meta)
  const usage = limits.usage.find((u) => u.accountId === account)
  if (!usage?.windows.length) return null
  const windows = windowsOfModel(usage.windows, chosenModel(limits.models[meta.provider], meta.model)).slice(0, 2)
  const labels = shortWindowLabels(windows)
  return {
    windows: windows.map((w, i) => ({ key: w.key, short: labels[i] ?? w.label, label: w.label, percent: clampPercent(w.usedPercent) })),
    limited: !!usage.limited,
  }
}
