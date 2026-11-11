import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// 组件预览页：packages/ui 自带的轻量页面，用来看所有原子组件的各种状态和深浅两套主题。
// 不是文档站，不发布；`pnpm --filter @dramai/ui dev` 打开，`build` 只是验证它能构建。
export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5180, open: false },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})
