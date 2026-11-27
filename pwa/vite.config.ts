import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { build, defineConfig, type Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
// The app's alias, so its client files (src/client) come over unchanged.
const alias = { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) }
const target = 'es2023'

/**
 * The service worker as one classic script at /app/sw.js: its scope is the folder it is served from, it
 * must keep its name across versions (no hash), and module workers are not everywhere yet. Built on its
 * own, so it shares no chunk with the page; in development it is built on each request.
 */
function serviceWorker(): Plugin {
  const bundle = async (): Promise<string> => {
    const result = await build({
      configFile: false,
      root,
      logLevel: 'warn',
      publicDir: false,
      resolve: { alias },
      build: {
        write: false,
        target,
        minify: true,
        lib: { entry: 'src/sw.ts', formats: ['iife'], name: 'nexaServiceWorker', fileName: () => 'sw.js' },
      },
    })
    const output = (Array.isArray(result) ? result[0] : result) as { output?: { type: string; code?: string }[] }
    const chunk = output.output?.find((file) => file.type === 'chunk')
    if (!chunk?.code) throw new Error('service worker: no output')
    return chunk.code
  }
  return {
    name: 'nexa-service-worker',
    configureServer(server) {
      server.middlewares.use('/app/sw.js', (_req, res, next) => {
        bundle().then((code) => {
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(code)
        }, next)
      })
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: await bundle() })
    },
  }
}

// The server serves the build at /app/ (src/pwa.ts); in development Vite serves it and passes the API on.
export default defineConfig({
  root,
  base: '/app/',
  plugins: [vue(), tailwindcss(), serviceWorker()],
  resolve: { alias },
  build: {
    outDir: fileURLToPath(new URL('../dist/app', import.meta.url)),
    emptyOutDir: true,
    target,
  },
  server: {
    proxy: {
      '/v1': { target: `http://127.0.0.1:${process.env.NEXA_PORT || 8080}`, ws: true },
    },
  },
})
