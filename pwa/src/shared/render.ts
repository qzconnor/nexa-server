import type { RenderSpec } from './chat'
import { isPlainObject } from './utils'

/**
 * Nexa's own MCP tools that draw something in the chat. The model calls them with the data; the
 * window draws the input of the call (src/renderer/src/components/render). The server only checks
 * the input and answers that it is shown (src/main/mcp/render-tools.ts).
 */
export const RENDER_SERVER = 'nexa'

export const RENDER_TOOLS = {
  render_chart: 'chart',
  render_diagram: 'diagram',
  render_table: 'table',
  render_stats: 'stats',
  render_callout: 'callout',
  render_code: 'code',
} as const satisfies Record<string, RenderSpec['type']>

export type RenderToolName = keyof typeof RENDER_TOOLS

export function isRenderTool(name: string): name is RenderToolName {
  return Object.hasOwn(RENDER_TOOLS, name)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** The input of a render tool as a spec, or an error in German for the model. */
export function parseRenderInput(tool: RenderToolName, input: unknown): { spec: RenderSpec } | { error: string } {
  if (!isPlainObject(input)) return { error: 'Die Eingabe muss ein Objekt sein.' }
  const title = str(input.title)
  const description = str(input.description)
  switch (RENDER_TOOLS[tool]) {
    case 'chart': {
      const chart = input.chart
      if (chart !== 'bar' && chart !== 'line' && chart !== 'area' && chart !== 'pie' && chart !== 'donut') {
        return { error: '`chart` muss bar, line, area, pie oder donut sein.' }
      }
      const data = Array.isArray(input.data) ? input.data.filter(isPlainObject) : []
      if (data.length === 0) return { error: '`data` braucht mindestens eine Zeile.' }
      const x = str(input.x)
      if (!x) return { error: '`x` muss die Spalte der Kategorien nennen.' }
      const series = Array.isArray(input.series)
        ? input.series
            .map((s) => (typeof s === 'string' ? { key: s } : isPlainObject(s) && str(s.key) ? { key: s.key as string, label: str(s.label) } : null))
            .filter((s): s is { key: string; label: string | undefined } => s !== null)
        : []
      if (series.length === 0) return { error: '`series` braucht mindestens eine Datenreihe.' }
      return {
        spec: {
          type: 'chart',
          chart,
          title,
          description,
          x,
          series,
          data: data as Record<string, string | number>[],
          stacked: input.stacked === true,
          unit: str(input.unit),
        },
      }
    }
    case 'diagram': {
      const mermaid = str(input.mermaid)
      if (!mermaid) return { error: '`mermaid` muss den Quelltext des Diagramms enthalten.' }
      return { spec: { type: 'diagram', title, description, mermaid } }
    }
    case 'table': {
      const columns = Array.isArray(input.columns)
        ? input.columns
            .map((c) =>
              typeof c === 'string'
                ? { key: c, label: c }
                : isPlainObject(c) && str(c.key)
                  ? {
                      key: c.key as string,
                      label: str(c.label) ?? (c.key as string),
                      align: c.align === 'right' || c.align === 'center' ? (c.align as 'right' | 'center') : undefined,
                    }
                  : null,
            )
            .filter((c): c is NonNullable<typeof c> => c !== null)
        : []
      if (columns.length === 0) return { error: '`columns` braucht mindestens eine Spalte.' }
      const rows = Array.isArray(input.rows) ? input.rows.filter(isPlainObject) : []
      return { spec: { type: 'table', title, description, columns, rows: rows as Record<string, string | number | boolean | null>[] } }
    }
    case 'stats': {
      const items = Array.isArray(input.items)
        ? input.items
            .filter(isPlainObject)
            .map((i) => ({
              label: String(i.label ?? ''),
              value: String(i.value ?? ''),
              hint: str(i.hint),
              trend: i.trend === 'up' || i.trend === 'down' || i.trend === 'flat' ? (i.trend as 'up' | 'down' | 'flat') : undefined,
            }))
        : []
      if (items.length === 0) return { error: '`items` braucht mindestens einen Wert.' }
      return { spec: { type: 'stats', title, items } }
    }
    case 'callout': {
      const text = str(input.text)
      if (!text) return { error: '`text` fehlt.' }
      const tone = input.tone === 'success' || input.tone === 'warning' || input.tone === 'danger' ? input.tone : 'info'
      return { spec: { type: 'callout', tone, title, text } }
    }
    case 'code': {
      const code = typeof input.code === 'string' ? input.code : undefined
      if (code === undefined) return { error: '`code` fehlt.' }
      return { spec: { type: 'code', title, language: str(input.language), code } }
    }
  }
}

/** The spec of a finished tool call of the render server, if it is one. */
export function renderSpecOf(server: string | undefined, tool: string, input: unknown): RenderSpec | undefined {
  if (server !== RENDER_SERVER || !isRenderTool(tool)) return undefined
  const parsed = parseRenderInput(tool, input)
  return 'spec' in parsed ? parsed.spec : undefined
}
