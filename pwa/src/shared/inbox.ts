import { isPendingInteraction, isUnread, type ChatItem, type InteractionItem, type ProviderId, type SessionResume, type SessionRuntime } from './chat'
import type { SessionMeta } from './types'

/**
 * The phone's inbox (the PWA of nexa-server, `docs/NEXA-SERVER.md`, „PWA“): a computer's chats that
 * need the user, in one answer of `sessions:inbox`. The PWA asks each computer again when one of its
 * chats changes (`sessions:changed`, a `runtime` event), as it gets those for every chat.
 */

/**
 * In this order: an answer it waits for (a question, a permission, a plan), what failed or stopped at
 * a limit, a finished turn nobody has looked at, an agent at work.
 */
export const INBOX_SECTIONS = ['waiting', 'trouble', 'unread', 'running'] as const
export type InboxSection = (typeof INBOX_SECTIONS)[number]

export interface InboxEntry {
  section: InboxSection
  id: string
  title: string
  /** Names it the PWA gets with `projects:list`. */
  projectId: string
  provider: ProviderId
  updatedAt: number
  /** First words of the last prompt or answer. */
  preview?: string
  /** `waiting`: what waits for the user, to answer with `sessions:respond` without opening the chat. */
  pending?: InteractionItem[]
  /** `trouble`: what failed. */
  error?: string
  /** `trouble`: stopped at its account's limit, and when it goes on. */
  resume?: SessionResume
}

/** The section a chat goes in; null: it needs nothing. */
export function inboxSection(meta: Pick<SessionMeta, 'finishedAt' | 'seenAt'>, runtime: SessionRuntime | undefined): InboxSection | null {
  const status = runtime?.status
  if (status === 'waiting') return 'waiting'
  if (status === 'error' || runtime?.resume) return 'trouble'
  if (status === 'starting' || status === 'running') return 'running'
  return isUnread(meta) ? 'unread' : null
}

/**
 * The chats that need the user, by section, the newest first in each. Archived ones are put away, and
 * stay out. `items`: the chat's items where the device has them loaded (a chat that waits has).
 */
export function inboxEntries(
  metas: readonly SessionMeta[],
  runtimeOf: (id: string) => SessionRuntime | undefined,
  itemsOf: (id: string) => readonly ChatItem[] | null,
): InboxEntry[] {
  const entries: InboxEntry[] = []
  for (const meta of metas) {
    if (meta.archived) continue
    const runtime = runtimeOf(meta.id)
    const section = inboxSection(meta, runtime)
    if (!section) continue
    const entry: InboxEntry = { section, id: meta.id, title: meta.title, projectId: meta.projectId, provider: meta.provider, updatedAt: meta.updatedAt }
    if (meta.preview) entry.preview = meta.preview
    if (section === 'waiting') entry.pending = (itemsOf(meta.id) ?? []).filter(isPendingInteraction)
    if (section === 'trouble') {
      if (runtime?.error) entry.error = runtime.error
      if (runtime?.resume) entry.resume = runtime.resume
    }
    entries.push(entry)
  }
  const order = (section: InboxSection) => INBOX_SECTIONS.indexOf(section)
  return entries.sort((a, b) => order(a.section) - order(b.section) || b.updatedAt - a.updatedAt)
}
