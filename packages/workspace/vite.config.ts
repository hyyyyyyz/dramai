import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// favicon 的源文件在 @dramai/ui 里；构建 / 开发时仍以 /favicon.svg 提供，保持原有 URL 不变。
function brandFavicon(): Plugin {
  const file = createRequire(import.meta.url).resolve('@dramai/ui/brand/favicon.svg')
  return {
    name: 'dramai:brand-favicon',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url === '/favicon.svg' || url === `${server.config.base}favicon.svg`) {
          res.setHeader('Content-Type', 'image/svg+xml')
          res.end(fs.readFileSync(file))
          return
        }
        next()
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'favicon.svg', source: fs.readFileSync(file) })
    },
  }
}

// GitHub Pages 部署在 https://hyyyyyyz.github.io/dramai/
// 因此默认 base = "/dramai/"。本地或自托管时可用 VITE_BASE 覆盖。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE ?? '/dramai/'

  return {
    base,
    plugins: [react(), tailwindcss(), brandFavicon()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      open: false,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  }
})
