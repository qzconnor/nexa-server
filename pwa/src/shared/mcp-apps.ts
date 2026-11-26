import { isPlainObject } from './utils'

/**
 * MCP Apps (SEP-1865, extension `io.modelcontextprotocol/ui`, spec 2026-01-26): an MCP tool names a
 * `ui://` resource in its `_meta`, an HTML page the host shows in the chat in a sandboxed frame; the
 * page talks to the host over `postMessage` (JSON-RPC). Nexa reads the page and calls tools through
 * the chat's CLI, which holds the server's connection (PROTOCOLS.md, „MCP Apps“).
 */

export const MCP_APP_MIME = 'text/html;profile=mcp-app'
export const MCP_APP_PROTOCOL = '2026-01-26'
/** The scheme the pages are served from (main/mcp-apps/mcp-app-views.ts), each with its own CSP. */
export const MCP_APP_SCHEME = 'nexa-app'
const UI_SCHEME = 'ui://'
const MAX_URI = 2048
/** What a page may be; larger ones are refused rather than slowing the chat down. */
export const MAX_APP_HTML = 5 * 1024 * 1024
/** What of a tool's result is kept with the chat for its page (`structuredContent`, `_meta`). */
export const MAX_APP_RESULT_JSON = 512 * 1024

export const McpAppsInvoke = {
  /** Reads the page of a tool item and gives it an address of the scheme. */
  open: 'mcp-apps:open',
  /** A tool of the page's server, which the page asked for (`tools/call`). */
  callTool: 'mcp-apps:call-tool',
  /** A resource of the page's server (`resources/read`). */
  readResource: 'mcp-apps:read-resource',
  /** The page of a tool item with the tool's result, for another device's window (Remote Control). */
  page: 'mcp-apps:page',
  /** The page of a tool item of another device's chat, fetched from there and served here. */
  openRemote: 'mcp-apps:open-remote',
} as const

export type McpAppVisibility = 'model' | 'app'

/** The page a tool item has: on which server, for which tool. */
export interface McpAppRef {
  /** The server as the CLI names it in its own calls (Claude Code: as `mcp_status` reports it). */
  server: string
  tool: string
  resourceUri: string
}

/** A tool's result as the page gets it (`ui/notifications/tool-result`, a `CallToolResult`). */
export interface McpAppToolResult {
  content: unknown[]
  structuredContent?: unknown
  _meta?: Record<string, unknown>
  isError?: boolean
}

/** What a tool's descriptor says about pages: its own, and who may call it. */
export interface McpToolUi {
  resourceUri: string | null
  visibility: McpAppVisibility[]
}

/** The `csp` of a page's resource (`_meta.ui.csp`). */
export interface McpAppCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

export interface McpAppOpened {
  /** Where the frame loads the page from. */
  url: string
  /** The page wants a border and background (true), none (false), or leaves it to Nexa (null). */
  prefersBorder: boolean | null
}

/** A page as the host gives it to another device (`mcp-apps:page`): the chat there doesn't carry results. */
export interface McpAppRemotePage {
  html: string
  meta: Record<string, unknown>
  result: McpAppToolResult | null
}

export interface McpAppsApi {
  open(sessionId: string, itemId: string): Promise<McpAppOpened>
  /** The page of a tool item in a chat of another device, with the tool's result (which its chat there leaves out). */
  openRemote(device: string, sessionId: string, itemId: string): Promise<McpAppOpened & { result: McpAppToolResult | null }>
  callTool(sessionId: string, itemId: string, name: string, args: Record<string, unknown>): Promise<McpAppToolResult>
  readResource(sessionId: string, itemId: string, uri: string): Promise<unknown>
}

/** A `ui://` address as a page's resource; null for anything else. */
export function uiUri(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith(UI_SCHEME) && value.length > UI_SCHEME.length && value.length <= MAX_URI ? value : null
}

/**
 * The page and audience a tool's `_meta` names: `ui.resourceUri` and `ui.visibility`, or the older
 * flat `ui/resourceUri`. Without a visibility both may call it, as the spec says.
 */
export function toolUiOf(meta: unknown): McpToolUi {
  const m = isPlainObject(meta) ? meta : {}
  const ui = isPlainObject(m.ui) ? m.ui : {}
  const listed = Array.isArray(ui.visibility) ? ui.visibility.filter((v): v is McpAppVisibility => v === 'model' || v === 'app') : null
  return { resourceUri: uiUri(ui.resourceUri) ?? uiUri(m['ui/resourceUri']), visibility: listed ?? ['model', 'app'] }
}

/** Claude Code's name for a server in tool names: anything but letters, digits, `_` and `-` becomes `_`. */
export function claudeServerKey(server: string): string {
  return server.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** A JSON value that holds no more than `max` characters, else undefined (too big to keep, or not JSON). */
export function boundedJson<T>(value: T, max: number): T | undefined {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    return text !== undefined && text.length <= max ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * A tool's result for its page, from what the CLI reports: the content blocks (a CLI that gives text
 * only gets one text block), `structuredContent` and `_meta` while they are small enough to keep.
 */
export function appResultOf(raw: unknown, isError = false): McpAppToolResult {
  const r = isPlainObject(raw) ? raw : {}
  const content = Array.isArray(r.content)
    ? r.content.filter(isPlainObject)
    : typeof r.content === 'string'
      ? [{ type: 'text', text: r.content }]
      : typeof raw === 'string'
        ? [{ type: 'text', text: raw }]
        : []
  const result: McpAppToolResult = { content: boundedJson(content, MAX_APP_RESULT_JSON) ?? [] }
  const structured = boundedJson(r.structuredContent, MAX_APP_RESULT_JSON)
  if (structured !== undefined) result.structuredContent = structured
  const meta = isPlainObject(r._meta) ? boundedJson(r._meta, MAX_APP_RESULT_JSON) : undefined
  if (meta) result._meta = meta
  if (isError || r.isError === true) result.isError = true
  return result
}

/** One origin or wildcard host a page names for its CSP; anything that could end the directive is left out. */
function source(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^(https?|wss?):\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/i.test(value) ? value : null
}

function sources(list: unknown): string[] {
  return Array.isArray(list) ? [...new Set(list.map(source).filter((s): s is string => s !== null))].slice(0, 50) : []
}

/** The `csp` a resource's `_meta.ui` names, with only well-formed origins. */
export function cspOf(meta: unknown): McpAppCsp {
  const ui = isPlainObject(meta) && isPlainObject(meta.ui) ? meta.ui : {}
  const csp = isPlainObject(ui.csp) ? ui.csp : {}
  return {
    connectDomains: sources(csp.connectDomains),
    resourceDomains: sources(csp.resourceDomains),
    frameDomains: sources(csp.frameDomains),
    baseUriDomains: sources(csp.baseUriDomains),
  }
}

/**
 * The Content-Security-Policy a page runs under: inline scripts and styles of its own, and of the
 * outside only what its resource declares (spec, „Security“). Nothing declared: no connections.
 */
export function mcpAppCsp(csp: McpAppCsp): string {
  const join = (list: string[] | undefined) => (list?.length ? ` ${list.join(' ')}` : '')
  const resources = join(csp.resourceDomains)
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' blob:${resources}`,
    `style-src 'unsafe-inline'${resources}`,
    `img-src data: blob:${resources}`,
    `font-src data:${resources}`,
    `media-src data: blob:${resources}`,
    `connect-src${csp.connectDomains?.length ? join(csp.connectDomains) : " 'none'"}`,
    `frame-src${csp.frameDomains?.length ? join(csp.frameDomains) : " 'none'"}`,
    `base-uri${csp.baseUriDomains?.length ? join(csp.baseUriDomains) : " 'none'"}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ')
}
