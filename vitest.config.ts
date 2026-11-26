import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // As in pwa/vite.config.ts, for the web app's tests.
  resolve: { alias: { '@shared': fileURLToPath(new URL('./pwa/src/shared', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'pwa/src/**/*.test.ts'],
    // Vitest empties CSS imports, `?raw` too; the theme test reads the web app's tokens from it.
    css: { include: [/pwa\/src\/main\.css/] },
  },
})
