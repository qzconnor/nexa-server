import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('markdown', () => {
  it('never lets raw HTML through', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> <script>alert(1)</script>\n\n<b>fett</b>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('opens links in a new tab and drops scripts as links', () => {
    expect(renderMarkdown('[Seite](https://example.com)')).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Seite</a>')
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('<a')
    // Files on the computer: nothing a page could open.
    expect(renderMarkdown('[Datei](file:///C:/x.txt)')).not.toContain('<a')
  })

  it('shows pictures as links, never loads them', () => {
    const html = renderMarkdown('![Ein Bild](https://example.com/a.png "t")')
    expect(html).not.toContain('<img')
    expect(html).toContain('<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer">Ein Bild</a>')
    expect(renderMarkdown('![x](data:image/png;base64,AAAA)')).not.toContain('<a')
  })

  it('frames tables and keeps line breaks where asked', () => {
    expect(renderMarkdown('| a |\n|---|\n| 1 |')).toContain('<div class="md-table"><table>')
    expect(renderMarkdown('eins\nzwei', true)).toContain('<br>')
    expect(renderMarkdown('eins\nzwei')).not.toContain('<br>')
  })
})
