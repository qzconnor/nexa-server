import { isPlainObject } from './utils'

/**
 * The open pull requests of a chat's repository, under the composer as in Claude Code: GitHub's, read
 * with the GitHub CLI (`gh pr list`) and its login, so Nexa needs no token of its own.
 */

/** What GitHub says of a pull request's reviews; null: it needs none. */
export type PullRequestReview = 'approved' | 'changes' | 'required'
/** Its checks taken together; null: it has none. */
export type PullRequestChecks = 'passing' | 'failing' | 'pending'

export interface PullRequestInfo {
  number: number
  title: string
  url: string
  /** The branch it brings in (`headRefName`). */
  branch: string
  /** The branch it goes into. */
  base: string
  draft: boolean
  review: PullRequestReview | null
  checks: PullRequestChecks | null
  /** Login of who opened it. */
  author: string
  updatedAt: number
}

/** Why a folder shows no pull requests. */
export type PullRequestsMissing =
  /** No repository, or one without a remote on GitHub. */
  | 'no-github'
  /** The GitHub CLI isn't installed. */
  | 'no-gh'
  /** The GitHub CLI isn't signed in (`gh auth login`). */
  | 'signed-out'
  | 'error'

export type PullRequestList =
  | {
      ok: true
      /** Open ones, the newest change first; at most `MAX_PULL_REQUESTS`. */
      pullRequests: PullRequestInfo[]
      /** The repository's page, for „all pull requests“. */
      webUrl: string
      /** When GitHub was asked. */
      at: number
    }
  | { ok: false; missing: PullRequestsMissing; message?: string }

/** More than fit in the menu; the rest are on GitHub's page. */
export const MAX_PULL_REQUESTS = 30

/** The fields `gh pr list --json` is asked for. */
export const GH_PR_FIELDS = 'number,title,url,headRefName,baseRefName,isDraft,reviewDecision,author,updatedAt,statusCheckRollup'

const FAILED = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

/**
 * The checks of a pull request taken together, as GitHub's mark beside it: failing when one failed,
 * pending while one runs or waits, else passing. `statusCheckRollup` mixes check runs (`status`,
 * `conclusion`) and the older commit statuses (`state`).
 */
export function checksOf(rollup: unknown): PullRequestChecks | null {
  if (!Array.isArray(rollup) || !rollup.length) return null
  let pending = false
  for (const check of rollup) {
    if (!isPlainObject(check)) continue
    const result = String(check.conclusion || check.state || '').toUpperCase()
    if (FAILED.has(result)) return 'failing'
    const done = check.status === undefined || String(check.status).toUpperCase() === 'COMPLETED'
    if (!done || !PASSED.has(result)) pending = true
  }
  return pending ? 'pending' : 'passing'
}

function reviewOf(decision: unknown): PullRequestReview | null {
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes'
  if (decision === 'REVIEW_REQUIRED') return 'required'
  return null
}

/** The output of `gh pr list --json GH_PR_FIELDS`, the newest change first; entries it can't read are left out. */
export function parsePullRequests(raw: unknown): PullRequestInfo[] {
  if (!Array.isArray(raw)) return []
  const list: PullRequestInfo[] = []
  for (const pr of raw) {
    if (!isPlainObject(pr) || typeof pr.number !== 'number' || typeof pr.url !== 'string') continue
    const updated = typeof pr.updatedAt === 'string' ? Date.parse(pr.updatedAt) : NaN
    list.push({
      number: pr.number,
      title: typeof pr.title === 'string' ? pr.title : '',
      url: pr.url,
      branch: typeof pr.headRefName === 'string' ? pr.headRefName : '',
      base: typeof pr.baseRefName === 'string' ? pr.baseRefName : '',
      draft: pr.isDraft === true,
      review: reviewOf(pr.reviewDecision),
      checks: checksOf(pr.statusCheckRollup),
      author: isPlainObject(pr.author) && typeof pr.author.login === 'string' ? pr.author.login : '',
      updatedAt: Number.isNaN(updated) ? 0 : updated,
    })
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PULL_REQUESTS)
}

/** Whether GitHub's CLI serves this web page: github.com and GitHub Enterprise hosts named after it. */
export function isGitHub(webUrl: string): boolean {
  const host = /^https?:\/\/([^/:]+)/i.exec(webUrl)?.[1]?.toLowerCase() ?? ''
  return host.includes('github')
}
