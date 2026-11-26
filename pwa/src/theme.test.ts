import { describe, expect, it } from 'vitest'
import css from './main.css?raw'
import { themes, themeTokens } from './theme'

const block = (start: string) => css.slice(css.indexOf(start), css.indexOf('\n}', css.indexOf(start)))
const declared = (text: string) => new Set([...text.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]!))
/** Tokens main.css sets itself rather than taking them from the theme. */
const OWN = new Set([...declared(block('@theme inline {')), '--radius', '--header-height', '--tabbar-height'])
const read = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!).filter((token) => !OWN.has(token)))
const fallbacks = declared(block(':root {'))

describe('themeTokens', () => {
  it('sets every token main.css reads, for every theme', () => {
    expect(read.size).toBeGreaterThan(20)
    for (const theme of themes) {
      const tokens = themeTokens(theme)
      for (const token of read) expect(tokens[token], `${theme.id} ${token}`).toBeTruthy()
      for (const value of Object.values(tokens)) expect(value).not.toMatch(/undefined|NaN/)
    }
  })

  it('has a first-paint value in main.css for each of them', () => {
    for (const token of read) expect(fallbacks, token).toContain(token)
  })
})
