// The PWA of nexa-server copies this file byte for byte: imports only from `@shared/…`, no Node APIs
// (main/server-link/pwa-copies.test.ts).
import type { PullRequestInfo } from '@shared/pull-requests'

/** How a pull request stands, as Claude Code colours it under its input: ready, waiting, held up, draft. */
export type PullRequestTone = 'ok' | 'warn' | 'bad' | 'draft' | 'open'

/**
 * What stands out about a pull request, in a word: what holds it up first (failed checks, changes asked
 * for), then what it waits for (running checks, a review), then that it may go in.
 */
export function pullRequestState(pr: Pick<PullRequestInfo, 'draft' | 'review' | 'checks'>): { tone: PullRequestTone; label: string } {
  if (pr.draft) return { tone: 'draft', label: 'Entwurf' }
  if (pr.checks === 'failing') return { tone: 'bad', label: 'Checks fehlgeschlagen' }
  if (pr.review === 'changes') return { tone: 'bad', label: 'Änderungen angefragt' }
  if (pr.checks === 'pending') return { tone: 'warn', label: 'Checks laufen' }
  if (pr.review === 'required') return { tone: 'warn', label: 'Review ausstehend' }
  if (pr.review === 'approved') return { tone: 'ok', label: 'Freigegeben' }
  if (pr.checks === 'passing') return { tone: 'ok', label: 'Checks bestanden' }
  return { tone: 'open', label: 'Offen' }
}

/** Icon colour of a tone (full class names, so Tailwind finds them). */
export const pullRequestToneClass: Record<PullRequestTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
  draft: 'text-muted-foreground',
  open: 'text-foreground',
}

/** The pull request of the checked-out branch first, the rest as GitHub sorts them (newest change first). */
export function sortForBranch(list: readonly PullRequestInfo[], branch: string | null): PullRequestInfo[] {
  const own = branch ? list.find((pr) => pr.branch === branch) : undefined
  return own ? [own, ...list.filter((pr) => pr !== own)] : [...list]
}
