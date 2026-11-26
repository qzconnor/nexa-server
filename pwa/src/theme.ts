import { computed, ref, watchEffect } from 'vue'
import { codeColor } from './lib/code-colors'
import { DEFAULT_THEME_ID, findTheme, THEMES } from './shared/themes/builtin'
import type { AppTheme } from './shared/themes/types'

const mix = (color: string, percent: number, other = 'transparent') => `color-mix(in oklab, ${color} ${percent}%, ${other})`

/** How opaque the layers are, the desktop app's default (Einstellungen › Darstellung). */
const SURFACE_OPACITY = 72

/**
 * The design tokens of a theme as CSS variables, the same as the desktop app's themeTokens
 * (nexa-app src/renderer/src/themes/apply.ts) with the window material on. A browser has no Mica or
 * Acrylic, so main.css paints a stand-in from the theme's colours under the translucent layers.
 * Radius and fonts are fixed in main.css.
 */
export function themeTokens(theme: Pick<AppTheme, 'mode' | 'colors' | 'terminal'>): Record<string, string> {
  const c = theme.colors
  const t = theme.terminal
  const opacity = SURFACE_OPACITY
  const isDark = theme.mode === 'dark'
  const code = (color: string) => codeColor(color, t.background)

  return {
    '--background': c.background,
    '--foreground': c.foreground,
    '--card': mix(c.surface, Math.min(100, opacity + 8)),
    '--card-foreground': c.foreground,
    '--popover': c.popover,
    '--popover-foreground': c.foreground,
    '--primary': c.primary,
    '--primary-foreground': c.primaryForeground,
    '--secondary': mix(c.foreground, isDark ? 9 : 7),
    '--secondary-foreground': c.foreground,
    '--muted': mix(c.foreground, isDark ? 7 : 5),
    '--muted-foreground': c.mutedForeground,
    '--accent': mix(c.foreground, isDark ? 10 : 7),
    '--accent-foreground': c.foreground,
    '--destructive': c.destructive,
    '--border': mix(c.foreground, isDark ? 11 : 13),
    '--input': mix(c.foreground, isDark ? 15 : 18),
    '--ring': mix(c.primary, 65),
    '--chart-1': c.primary,
    '--chart-2': t.blue,
    '--chart-3': t.green,
    '--chart-4': t.yellow,
    '--chart-5': t.magenta,
    '--surface': mix(c.surface, opacity),
    '--surface-strong': mix(c.surface, Math.min(100, opacity + 18)),
    '--surface-solid': mix(c.surface, opacity, c.background),
    '--success': c.success,
    '--warning': c.warning,
    '--window-bg': mix(c.background, opacity),
    '--code-bg': mix(t.background, Math.min(100, opacity + 10)),
    '--code-fg': t.foreground,
    '--syn-red': code(t.red),
    '--syn-green': code(t.green),
    '--syn-yellow': code(t.yellow),
    '--syn-blue': code(t.blue),
    '--syn-magenta': code(t.magenta),
    '--syn-cyan': code(t.cyan),
    '--syn-comment': mix(t.foreground, 50),
  }
}

/** Writes the tokens to <html>, and the theme's background to the browser's bars. */
export function applyTheme(theme: AppTheme, root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(themeTokens(theme))) root.style.setProperty(key, value)
  root.classList.toggle('dark', theme.mode === 'dark')
  root.style.colorScheme = theme.mode
  root.dataset.theme = theme.id
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.background)
}

const STORAGE_KEY = 'nexa.theme'

/** The chosen theme; a choice per device, like the app's appearance settings. */
export const themeId = ref(readThemeId())
export const theme = computed(() => findTheme(themeId.value))
export const themes = THEMES

/** Applies the chosen theme now and whenever it changes. */
export function startTheme(): void {
  watchEffect(() => {
    applyTheme(theme.value)
    try {
      if (themeId.value === DEFAULT_THEME_ID) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, themeId.value)
    } catch {
      // Private mode may refuse storage; the theme then lasts until the page closes.
    }
  })
}

function readThemeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && THEMES.some((t) => t.id === stored)) return stored
  } catch {
    // See above.
  }
  return DEFAULT_THEME_ID
}
