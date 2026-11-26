import MarkdownIt from 'markdown-it'

/**
 * Markdown of the chats, as the app renders it (its useMarkdown.ts): raw HTML off, so the output is
 * safe for v-html even though an agent's answer may hold anything. What differs is what a page can't do:
 * pictures from other hosts (the CSP allows none, and fetching them would tell those hosts who reads),
 * and links to files on the computer.
 */
function createRenderer(breaks: boolean) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks, typographer: false })
  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    tokens[idx]!.attrSet('target', '_blank')
    tokens[idx]!.attrSet('rel', 'noopener noreferrer')
    return self.renderToken(tokens, idx, options)
  }
  // A picture as a link to it, named by its alt text: tapping it opens the picture in the browser.
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx]!
    const src = String(token.attrGet('src') ?? '')
    const alt = token.children?.length ? md.renderer.renderInlineAsText(token.children, md.options, {}) : token.content
    const label = md.utils.escapeHtml(alt || src)
    if (!/^https?:\/\//i.test(src)) return label
    return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  }
  // Tables in a frame of their own that scrolls sideways: a phone is narrower than most.
  md.renderer.rules.table_open = () => '<div class="md-table"><table>\n'
  md.renderer.rules.table_close = () => '</table></div>\n'
  return md
}

const renderers = new Map<boolean, ReturnType<typeof createRenderer>>()

/** HTML of `source`; `breaks`: every line break counts, as in what a user typed. */
export function renderMarkdown(source: string, breaks = false): string {
  let md = renderers.get(breaks)
  if (!md) renderers.set(breaks, (md = createRenderer(breaks)))
  return md.render(source)
}
