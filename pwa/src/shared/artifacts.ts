import type { ChatItem } from './chat'

/**
 * Claude's artifacts: the pages and documents Claude Code publishes on claude.ai with its Artifact
 * tool, listed per account with the login's OAuth token (main/artifacts/artifact-service.ts).
 */

export const ArtifactsInvoke = {
  list: 'artifacts:list',
  thumbnail: 'artifacts:thumbnail',
  chats: 'artifacts:chats',
  rename: 'artifacts:rename',
  remove: 'artifacts:remove',
  setPinned: 'artifacts:set-pinned',
} as const

/** Longest title claude.ai takes. */
export const MAX_ARTIFACT_TITLE = 300

/** The address of an artifact the list names none for. */
export const ARTIFACT_URL = 'https://claude.ai/code/artifact/'

/** A page or document Claude published on claude.ai, as the account's login lists it. */
export interface Artifact {
  id: string
  /** Where claude.ai shows it: `https://claude.ai/artifact/<shortId>`, the link the Artifact tool reports. */
  url: string
  /** The id in that link, shorter than `id`; null where the list names no link. */
  shortId: string | null
  title: string
  description: string | null
  kind: 'page' | 'document'
  /** Made by the account's login, or shared with it. */
  mine: boolean
  /** Shared from another organization. */
  external: boolean
  /** Who may open it: its owner only, the people it is shared with, the organization or anyone with the link. */
  audience: ArtifactAudience | null
  createdAt: string | null
  updatedAt: string | null
  lastViewedAt: string | null
  /** How often it was opened; null where the list doesn't say. */
  views: number | null
  /** Pinned in the sidebar of claude.ai. */
  pinned: boolean
  /** The login may give it another title (its own, or where claude.ai says so). */
  renamable: boolean
}

export type ArtifactAudience = 'owner' | 'users' | 'org' | 'public'

export type ArtifactListStatus =
  | 'ok'
  /** The login can't list artifacts: an API key, a token without access, or not offered for it. */
  | 'unavailable'
  /** The login has expired or was signed out. */
  | 'signed-out'
  | 'error'

export interface ArtifactList {
  accountId: string
  status: ArtifactListStatus
  message: string | null
  /** Most recently viewed first. */
  artifacts: Artifact[]
  /** There were more than Nexa lists. */
  truncated: boolean
  /** claude.ai offers pinning to this login. */
  pinsEnabled: boolean
  fetchedAt: number
}

export interface ArtifactsApi {
  list(accountId: string): Promise<ArtifactList>
  /** The thumbnail of the last list as a `data:` URL; null without one. */
  thumbnail(accountId: string, id: string, dark: boolean): Promise<string | null>
  /** The chat each artifact came from, by the id in its link: the newest chat that names it. */
  chats(): Promise<Record<string, string>>
  /** Another title on claude.ai, for everyone it is shared with. */
  rename(accountId: string, id: string, title: string): Promise<void>
  /** Deletes an own artifact for good; `gone` when it was deleted already. */
  remove(accountId: string, id: string): Promise<'deleted' | 'gone'>
  /** Pins it in the sidebar of claude.ai, or takes it off. */
  setPinned(accountId: string, id: string, pinned: boolean): Promise<void>
}

/** A title as claude.ai keeps it: one line, without spaces around it. */
export function artifactTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim()
}

/** `claude.ai/artifact/<shortId>` as the Artifact tool reports it, `claude.ai/code/artifact/<id>` from Claude Code on the web. */
const LINK_RE = /claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]{8,128})/g

/** The artifacts a text links to, by the id in the link. */
export function artifactIds(text: string): string[] {
  return [...text.matchAll(LINK_RE)].map((m) => m[1]!)
}

/** A tool's output beyond this is a log or a file, not where an artifact's link stands. */
const MAX_SCANNED = 200_000

/** Claude Code's tool that publishes an artifact (and a new version of one) and reports its link. */
const PUBLISHING_TOOL = 'Artifact'

/** The artifacts a chat links to, by the id in the link: those it published, and those it only names. */
export interface ArtifactMentions {
  published: string[]
  named: string[]
}

/**
 * The artifacts a chat links to: published where Claude Code's Artifact tool reports the link of
 * what it published, named in prompts and answers or what other tools got and gave back.
 */
export function artifactLinks(items: readonly ChatItem[]): ArtifactMentions {
  const published = new Set<string>()
  const named = new Set<string>()
  const scan = (text: string | null | undefined, into: Set<string>) => {
    if (text && text.includes('/artifact/')) for (const id of artifactIds(text.slice(0, MAX_SCANNED))) into.add(id)
  }
  for (const item of items) {
    if (item.kind === 'user' || item.kind === 'assistant') scan(item.text, named)
    else if (item.kind === 'tool') {
      scan(item.output, item.name === PUBLISHING_TOOL && item.status !== 'error' ? published : named)
      scan(item.detail, named)
      if (item.input !== undefined && item.input !== null) scan(typeof item.input === 'string' ? item.input : safeJson(item.input), named)
    }
  }
  return { published: [...published], named: [...named].filter((id) => !published.has(id)) }
}

/**
 * The chat each artifact came from, of chats newest first: the newest that published it (its current
 * version comes from there), else the newest that names it.
 */
export function artifactChatMap(chats: readonly { id: string; mentions: ArtifactMentions }[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const chat of chats) for (const id of chat.mentions.published) map[id] ??= chat.id
  for (const chat of chats) for (const id of chat.mentions.named) map[id] ??= chat.id
  return map
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/** The chat an artifact came from, of those `chats` found by the ids in links. */
export function chatOfArtifact(chats: Readonly<Record<string, string>>, artifact: Pick<Artifact, 'id' | 'shortId'>): string | null {
  return (artifact.shortId ? chats[artifact.shortId] : undefined) ?? chats[artifact.id] ?? null
}
