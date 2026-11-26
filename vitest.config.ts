import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'pwa/src/**/*.test.ts'],
    // Vitest empties CSS imports, `?raw` too; the theme test reads the web app's tokens from it.
    css: { include: [/pwa\/src\/main\.css/] },
  },
})
