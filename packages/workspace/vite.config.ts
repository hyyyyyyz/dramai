import { defaultClientConditions, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// 开发时 /api 代理到本地服务（默认 8787，可用 DRAMAI_API 覆盖）。
// 不改 Host / Origin：服务端按同源校验写请求，代理保持原样即可通过。
// 构建产物由 @dramai/server 在根路径托管，所以 base 固定为 '/'。
const api = process.env.DRAMAI_API ?? 'http://127.0.0.1:8787'

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    // 前端依赖 @dramai/api 的源码，不要求先构建它。
    conditions: [...defaultClientConditions, 'dramai-source'],
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: { '/api': { target: api, changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true },
})
