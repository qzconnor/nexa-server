/**
 * A chat in a window of its own („In eigenem Fenster öffnen“): the window shows that one chat, the
 * main window keeps the sidebar and everything else. A chat is always in exactly one window: the
 * pages of its browser exist once, and so does its composer.
 */

/** The query parameter that makes the app's page a chat's own window: `?chat=<session id>`. */
export const CHAT_WINDOW_PARAM = 'chat'

/** The longest draft that moves between the windows with its chat (the composer takes no more). */
export const MAX_HANDOFF_TEXT = 1_000_000
/** Images a draft takes along at most. */
export const MAX_HANDOFF_IMAGES = 50

/** What goes along when a chat moves from one window to the other. */
export interface ChatHandoff {
  /** What was written in the composer and not sent yet. */
  draft: { text: string; images: string[] } | null
  /** The terminal beside the chat was open. */
  terminal: boolean
  /** The browser beside the chat was open. */
  browser: boolean
}

/**
 * What a chat's own window asks of the main window: what the main window does (open another chat,
 * the start page, delete with „Rückgängig“, the quick open). Main brings the main window to the front
 * with it.
 */
export type MainWindowRequest =
  | { kind: 'open'; sessionId: string }
  | { kind: 'new'; projectId: string | null }
  | { kind: 'remove'; sessionId: string }
  | { kind: 'palette'; query: string }

export const ChatWindowsInvoke = {
  /** Opens the chat in a window of its own, or brings that window to the front. */
  open: 'chat-windows:open',
  /** The chats that have a window of their own. */
  list: 'chat-windows:list',
  /** What came along with the chat into the window that asks (once). */
  takeHandoff: 'chat-windows:take-handoff',
  /** A chat's own window asks the main window for something (`MainWindowRequest`). */
  toMain: 'chat-windows:to-main',
  /** A chat's own window goes; its chat shows in the main window again. */
  dock: 'chat-windows:dock',
  /**
   * A chat's own window goes, and this goes back with its chat: its answer to `ChatWindowsEvent.closing`,
   * or the window closing itself (its chat ended or is gone). Not `window.close()` in the page: Electron
   * then drops the page without the window's `close`, and so without the question.
   */
  closing: 'chat-windows:closing',
  /** Closes the windows of these chats without asking them (the main window deletes them). */
  close: 'chat-windows:close',
} as const

export const ChatWindowsEvent = {
  /** The chats that have a window of their own, after one came or went. */
  changed: 'event:chat-windows-changed',
  /** To a chat's own window that is about to close: what should go back with its chat? */
  closing: 'event:chat-window-closing',
  /** To the main window: a chat came back from its own window, with what goes along. */
  returned: 'event:chat-window-returned',
  /** To the main window: what a chat's own window asks of it. */
  request: 'event:chat-window-request',
} as const

export interface ChatWindowsApi {
  open(sessionId: string, handoff?: ChatHandoff): Promise<void>
  list(): Promise<string[]>
  takeHandoff(sessionId: string): Promise<ChatHandoff | null>
  toMain(request: MainWindowRequest): Promise<void>
  /** From a chat's own window: back into the main window, which shows the chat. */
  dock(handoff: ChatHandoff): Promise<void>
  closing(handoff: ChatHandoff): Promise<void>
  close(sessionIds: string[]): Promise<void>
  onChanged(cb: (sessionIds: string[]) => void): () => void
  onClosing(cb: () => void): () => void
  onReturned(cb: (sessionId: string, handoff: ChatHandoff) => void): () => void
  onRequest(cb: (request: MainWindowRequest) => void): () => void
}

/** The chat whose own window a page is, from its address (`?chat=<id>`); null for the main window. */
export function chatWindowSession(search: string): string | null {
  const id = new URLSearchParams(search).get(CHAT_WINDOW_PARAM)
  return id && id.length <= 200 ? id : null
}

/** A handoff from a window, checked: unknown fields go, sizes are capped. */
export function parseHandoff(value: unknown): ChatHandoff {
  const empty: ChatHandoff = { draft: null, terminal: false, browser: false }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const { draft, terminal, browser } = value as Record<string, unknown>
  let parsed: ChatHandoff['draft'] = null
  if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
    const { text, images } = draft as Record<string, unknown>
    const safeText = typeof text === 'string' ? text.slice(0, MAX_HANDOFF_TEXT) : ''
    const safeImages = Array.isArray(images)
      ? images.filter((image): image is string => typeof image === 'string' && image.length > 0 && image.length <= 4096).slice(0, MAX_HANDOFF_IMAGES)
      : []
    if (safeText || safeImages.length) parsed = { text: safeText, images: safeImages }
  }
  return { draft: parsed, terminal: terminal === true, browser: browser === true }
}

/** The request of a chat's own window, checked. */
export function parseMainWindowRequest(value: unknown): MainWindowRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Anfrage fehlt.')
  const request = value as Record<string, unknown>
  const id = (field: unknown) => {
    if (typeof field !== 'string' || !field || field.length > 200) throw new Error('Der Chat fehlt.')
    return field
  }
  switch (request.kind) {
    case 'open':
      return { kind: 'open', sessionId: id(request.sessionId) }
    case 'remove':
      return { kind: 'remove', sessionId: id(request.sessionId) }
    case 'new':
      return { kind: 'new', projectId: request.projectId == null ? null : id(request.projectId) }
    case 'palette':
      return { kind: 'palette', query: typeof request.query === 'string' ? request.query.slice(0, 200) : '' }
    default:
      throw new Error('Unbekannte Anfrage.')
  }
}
