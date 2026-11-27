// The PWA of nexa-server copies this file byte for byte: imports only from `@shared/…`, `@lucide/vue`
// and types from `vue`, no Node APIs, no new `--tool-*` colours (main/server-link/pwa-copies.test.ts).
import {
  BotIcon,
  ChartColumnIcon,
  CircleHelpIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  ListChecksIcon,
  MapIcon,
  PlugIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { AssistantItem, ChatItem, ThinkingItem, ToolItem, ToolKind } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { isRenderTool, RENDER_SERVER, type RenderToolName } from '@shared/render'

/** Icon and colour per kind of tool, as Claude Manager's file tree colours what Claude does. */
export const TOOL_META: Record<ToolKind, { icon: Component; color: string }> = {
  bash: { icon: SquareTerminalIcon, color: 'text-(--tool-run)' },
  read: { icon: FileTextIcon, color: 'text-(--tool-read)' },
  edit: { icon: FilePenIcon, color: 'text-(--tool-write)' },
  write: { icon: FilePlusIcon, color: 'text-(--tool-write)' },
  search: { icon: SearchIcon, color: 'text-(--tool-search)' },
  web: { icon: GlobeIcon, color: 'text-(--tool-search)' },
  mcp: { icon: PlugIcon, color: 'text-muted-foreground' },
  todo: { icon: ListChecksIcon, color: 'text-muted-foreground' },
  plan: { icon: MapIcon, color: 'text-primary' },
  question: { icon: CircleHelpIcon, color: 'text-primary' },
  render: { icon: ChartColumnIcon, color: 'text-primary' },
  image: { icon: ImageIcon, color: 'text-muted-foreground' },
  other: { icon: WrenchIcon, color: 'text-muted-foreground' },
}

export const AGENT_ICON = BotIcon

/** A block of the timeline: one item, tool calls in a row, or what an agent did in the browser in a row. */
export type ChatBlock =
  | { type: 'item'; item: ChatItem }
  | { type: 'tools'; id: string; tools: ToolItem[] }
  | { type: 'browser'; id: string; tools: ToolItem[] }
  /** Thoughts in a row: one block that shows the newest. */
  | { type: 'thinking'; id: string; items: ThinkingItem[] }

/**
 * The action of one of the browser tools of Nexa's MCP server (`navigate` for `browser_navigate`), as
 * Claude (`mcp__nexa__browser_…`) or Codex (`nexa.browser_…`) names it; null for other tools.
 */
export function browserAction(tool: ToolItem): string | null {
  if (tool.server !== 'nexa') return null
  return /(?:^|__|\.)browser_([a-z_]+)$/.exec(tool.name)?.[1] ?? null
}

const BROWSER_STEPS: Record<string, string> = {
  navigate: 'Seite öffnen',
  history: 'Vor oder zurück',
  tabs: 'Tabs',
  snapshot: 'Seite lesen',
  take_screenshot: 'Screenshot',
  find: 'Auf der Seite suchen',
  click: 'Klicken',
  type: 'Eintippen',
  fill_form: 'Formular ausfüllen',
  press_key: 'Taste drücken',
  hover: 'Zeigen',
  select_option: 'Auswählen',
  scroll: 'Scrollen',
  drag: 'Ziehen',
  file_upload: 'Datei hochladen',
  handle_dialog: 'Dialog beantworten',
  wait_for: 'Warten',
  evaluate: 'Skript ausführen',
  resize: 'Größe ändern',
  emulate: 'Umgebung nachstellen',
  inspect: 'Element prüfen',
  check_accessibility: 'Barrierefreiheit prüfen',
  console_messages: 'Konsole lesen',
  network_requests: 'Netzwerk lesen',
  network_request: 'Anfrage lesen',
  performance: 'Leistung messen',
  storage: 'Speicher der Seite',
  route: 'Anfragen umleiten',
  clear_site_data: 'Daten der Seite löschen',
  pdf_save: 'Als PDF speichern',
  generate_test: 'Test erzeugen',
}

/** What Nexa's drawing tools make, in words. */
const RENDER_NAMES: Record<RenderToolName, string> = {
  render_chart: 'Chart',
  render_diagram: 'Diagramm',
  render_table: 'Tabelle',
  render_stats: 'Kennzahlen',
  render_callout: 'Hinweis',
  render_code: 'Code',
}

/** What Nexa's tools for the other chats do, in words. */
const CHAT_NAMES: Record<string, string> = {
  chat_list: 'Chats auflisten',
  chat_read: 'Chat lesen',
  sessions_search: 'Chats durchsuchen',
  chat_send: 'Nachricht an Chat',
  chat_new: 'Neuer Chat',
}

/** Nexa's other tools, about the app itself, in words. */
const APP_NAMES: Record<string, string> = {
  limits: 'Limits abfragen',
  notify: 'Benachrichtigung',
}

/** A notification of the agent by its title, which says more than the CLI's guess at a detail. */
function notifyDetail(tool: ToolItem): string | undefined {
  const title = (tool.input as { title?: unknown } | undefined)?.title
  return typeof title === 'string' && title.trim() ? `„${title.trim()}“` : tool.detail
}

/** One of Nexa's tools in words (`render_chart` → „Chart“, `browser_click` → „Klicken“). */
function nexaToolName(short: string): string {
  if (isRenderTool(short)) return RENDER_NAMES[short]
  if (CHAT_NAMES[short]) return CHAT_NAMES[short]
  if (APP_NAMES[short]) return APP_NAMES[short]
  const action = /^browser_(.+)$/.exec(short)?.[1]
  return (action && BROWSER_STEPS[action]) || short.replace(/_/g, ' ')
}

/**
 * The chat a call of the chat tools goes to, in words: the title for an id (`titleOf`), else the name
 * the agent gave; for a new chat its CLI and name, for a search its words.
 */
function chatToolDetail(short: string, tool: ToolItem, titleOf?: (id: string) => string | undefined): string | undefined {
  const input = (tool.input ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof input[key] === 'string' && input[key] ? (input[key] as string).trim() : undefined)
  if (short === 'chat_list') return text('query')
  if (short === 'sessions_search') {
    const query = text('query')
    const project = text('project')
    return [query && `„${query}“`, project && `in „${project}“`].filter(Boolean).join(' ') || undefined
  }
  if (short === 'chat_new') {
    const cli = text('cli')
    const provider = cli && Object.hasOwn(PROVIDERS, cli) ? PROVIDERS[cli as keyof typeof PROVIDERS].name : cli
    return [provider, text('title') && `„${text('title')}“`].filter(Boolean).join(' · ') || undefined
  }
  const ref = text(short === 'chat_send' ? 'to' : 'chat')
  return ref ? `„${titleOf?.(ref) ?? ref}“` : undefined
}

/** The tools of Nexa a ToolSearch of Claude Code loads by name (`select:mcp__nexa__render_chart,…`); null when it loads others too or searches. */
function nexaToolsLoaded(tool: ToolItem): string[] | null {
  if (tool.name !== 'ToolSearch') return null
  const query = (tool.input as { query?: unknown } | undefined)?.query
  if (typeof query !== 'string' || !query.startsWith('select:')) return null
  const prefix = `mcp__${RENDER_SERVER}__`
  const names = query.slice('select:'.length).split(',').map((name) => name.trim()).filter(Boolean)
  return names.length && names.every((name) => name.startsWith(prefix)) ? names.map((name) => name.slice(prefix.length)) : null
}

/**
 * A call of one of Nexa's own tools, or Claude loading them: they are the app itself, not a server the
 * user added, so they show with Nexa's mark and in words. `plumbing`: only the CLI getting the tools
 * ready, with nothing in it worth opening. Null for every other tool. `titleOf`: the title of a chat
 * by its id, for the chat tools.
 */
export function nexaToolView(
  tool: ToolItem,
  titleOf?: (id: string) => string | undefined,
): { title: string; detail?: string; plumbing: boolean } | null {
  const loaded = nexaToolsLoaded(tool)
  if (loaded) return { title: 'Nexa-Werkzeuge laden', detail: [...new Set(loaded.map(nexaToolName))].join(', '), plumbing: true }
  if (tool.server !== RENDER_SERVER) return null
  // Claude names them `mcp__nexa__render_chart`, Codex `nexa.render_chart`.
  const prefix = [`mcp__${RENDER_SERVER}__`, `${RENDER_SERVER}.`].find((p) => tool.name.startsWith(p)) ?? ''
  const short = tool.name.slice(prefix.length)
  const detail = CHAT_NAMES[short] ? chatToolDetail(short, tool, titleOf) : short === 'notify' ? notifyDetail(tool) : tool.detail
  return { title: nexaToolName(short), detail, plumbing: false }
}

/** Claude Code's ToolSearch for one of the browser tools (it loads them when it needs them). */
function loadsBrowserTool(tool: ToolItem): boolean {
  if (tool.name !== 'ToolSearch') return false
  const query = (tool.input as { query?: unknown } | undefined)?.query
  return typeof query === 'string' && /browser_/.test(query)
}

/** A browser tool call as a step of the browser card: what it does, and to what. */
export function browserStep(tool: ToolItem): { title: string; detail?: string } {
  const action = browserAction(tool) ?? ''
  const input = (tool.input ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof input[key] === 'string' && input[key] ? (input[key] as string) : undefined)
  const detail = text('url') ?? text('element') ?? text('key') ?? text('text') ?? text('selector') ?? text('ref')
  return { title: BROWSER_STEPS[action] ?? action.replace(/_/g, ' '), detail }
}

/**
 * The items of one thread (the main one or a subagent's) as blocks: tool calls in a row form a
 * group; drawings of Nexa's tools, todo lists and the tool calls behind a question stand alone or
 * are left out, as their own items show them.
 */
export function chatBlocks(
  items: readonly ChatItem[],
  parentId: string | null,
  showThinking: boolean,
  /** Whether an answer or thought has words; MessageList reads it past Vue, so each delta isn't a change. */
  hasText: (item: AssistantItem | ThinkingItem) => boolean = (item) => !!item.text.trim(),
): ChatBlock[] {
  // A tool call a question is about: the question shows it while it is open; questions and plans for good.
  const answeredTools = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'interaction' || !item.toolItemId) continue
    if (item.state === 'pending' || item.request.type === 'question' || item.request.type === 'plan') answeredTools.add(item.toolItemId)
  }
  const blocks: ChatBlock[] = []
  let group: ToolItem[] | null = null
  // The browser's steps in a row: one card with the page, not a row each.
  let browser: ToolItem[] | null = null
  for (const item of items) {
    if ((item.parentId ?? null) !== parentId) continue
    if (item.kind === 'tool') {
      if (item.tool === 'todo' || answeredTools.has(item.id)) continue
      if (browserAction(item)) {
        group = null
        if (!browser) {
          browser = []
          blocks.push({ type: 'browser', id: `browser:${item.id}`, tools: browser })
        }
        browser.push(item)
        continue
      }
      // Claude loading the next browser tool doesn't end the agent's work in the page.
      if (browser && loadsBrowserTool(item)) {
        browser.push(item)
        continue
      }
      browser = null
      // The user's own commands (`!`) aren't the agent's work: each stands alone, with its output; so
      // does a tool with a page of its own (MCP Apps), too large to fold into a group.
      if (item.render || item.byUser || item.app) {
        group = null
        blocks.push({ type: 'item', item })
        continue
      }
      if (!group) {
        group = []
        blocks.push({ type: 'tools', id: `tools:${item.id}`, tools: group })
      }
      group.push(item)
      continue
    }
    if (item.kind === 'thinking') {
      if (!showThinking || !hasText(item)) continue
      // Thinking between tool calls doesn't break their group (the calls after it join the group above),
      // so thoughts would stand one under the other: one block, the newest in place of the one before.
      const last = blocks.at(-1)
      if (last?.type === 'thinking') last.items.push(item)
      else blocks.push({ type: 'thinking', id: `thinking:${item.id}`, items: [item] })
      continue
    }
    if (item.kind === 'assistant' && !item.streaming && !hasText(item)) continue
    group = null
    browser = null
    blocks.push({ type: 'item', item })
  }
  return blocks
}

/** "3 Befehle, 2 Dateien bearbeitet, 4 gelesen" for a group of tool calls; Claude loading Nexa's tools isn't one of them. */
export function toolSummary(all: readonly ToolItem[]): string {
  const tools = all.filter((t) => !nexaToolView(t)?.plumbing)
  const count = (kinds: ToolKind[]) => tools.filter((t) => kinds.includes(t.tool)).length
  const parts: string[] = []
  const edits = new Set(tools.filter((t) => t.tool === 'edit' || t.tool === 'write').flatMap((t) => t.changes?.map((c) => c.path) ?? [t.detail ?? t.id]))
  const commands = count(['bash'])
  const reads = count(['read'])
  const searches = count(['search', 'web'])
  const other = tools.length - commands - reads - searches - count(['edit', 'write'])
  if (edits.size) parts.push(edits.size === 1 ? '1 Datei bearbeitet' : `${edits.size} Dateien bearbeitet`)
  if (commands) parts.push(commands === 1 ? '1 Befehl' : `${commands} Befehle`)
  if (reads) parts.push(reads === 1 ? '1 Datei gelesen' : `${reads} Dateien gelesen`)
  if (searches) parts.push(searches === 1 ? '1 Suche' : `${searches} Suchen`)
  if (other > 0) parts.push(other === 1 ? '1 Werkzeug' : `${other} Werkzeuge`)
  return parts.join(' · ')
}

/** `nexa-file://` URL of an image on disk (main/window/file-protocol.ts). */
export function fileImageUrl(path: string, from?: ImageSource | null): string {
  if (from) return `nexa-file://device?instance=${encodeURIComponent(from.device)}&session=${encodeURIComponent(from.sessionId)}&path=${encodeURIComponent(path)}`
  return `nexa-file://image?path=${encodeURIComponent(path)}`
}

/**
 * A picture in a chat of another device: its path is one there, so main fetches it from that device
 * (Remote Control), which gives out only pictures of that chat's prompts.
 */
export interface ImageSource {
  device: string
  sessionId: string
}
