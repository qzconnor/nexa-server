import type { ProviderId } from './chat'

/**
 * Notifications the agents send through Nexa (`notify` of Nexa's MCP server): a system notification
 * while Nexa isn't in front, else a toast in the window. A click opens the chat; buttons (`actions`)
 * answer the agent, which waits for the choice (main `mcp/notify-tool.ts`, `NotificationService.fromAgent`).
 */

export const MAX_NOTIFY_ACTIONS = 3
export const MAX_NOTIFY_TITLE = 120
export const MAX_NOTIFY_MESSAGE = 600
export const MAX_NOTIFY_ACTION = 40
/**
 * How long the agent waits for a choice by default, and at most: under the 900 s Codex gives a call of
 * Nexa's server (`mcp_servers.nexa.tool_timeout_sec`), so the answer still reaches it.
 */
export const DEFAULT_NOTIFY_WAIT_MINUTES = 10
export const MAX_NOTIFY_WAIT_MINUTES = 14

/** What the agent asks to show. */
export interface NotifyRequest {
  title: string
  message?: string
  /** Buttons; with them the agent waits for the user's choice. */
  actions: string[]
  /** How long it waits for a choice. */
  waitMs: number
}

/** A notification of an agent as the window shows it, as a toast. */
export interface AgentNotification {
  id: string
  sessionId: string
  /** The chat's title and CLI, so the toast says who sends it. */
  chat: string
  provider: ProviderId
  title: string
  message?: string
  actions: string[]
}

export type AgentNotificationAnswer = { kind: 'action'; action: string } | { kind: 'dismissed' }

/** What came of a notification, for the agent. */
export type NotifyOutcome =
  /** Shown; without buttons nothing more comes. */
  | { kind: 'shown' }
  | { kind: 'action'; action: string }
  | { kind: 'dismissed' }
  | { kind: 'timeout'; minutes: number }
  /** The turn was stopped, or a newer notification of the chat took its place. */
  | { kind: 'cancelled' | 'replaced' }
  /** The user switched notifications (from agents) off. */
  | { kind: 'off' }
