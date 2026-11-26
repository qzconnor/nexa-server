import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The server serves the build at /app/ (src/pwa.ts); in development Vite serves it and passes the API on.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  plugins: [vue(), tailwindcss()],
  // The app's alias, so its client files (src/client) come over unchanged.
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL('../dist/app', import.meta.url)),
    emptyOutDir: true,
    target: 'es2023',
  },
  server: {
    proxy: {
      '/v1': { target: `http://127.0.0.1:${process.env.NEXA_PORT || 8080}`, ws: true },
    },
  },
})
