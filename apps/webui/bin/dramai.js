#!/usr/bin/env node
// dramai WebUI 启动器入口。真正的代码在 dist/（pnpm build 产出）。
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const entry = new URL('../dist/cli.js', import.meta.url)
if (!existsSync(fileURLToPath(entry))) {
  const zh = /^zh/i.test(
    process.env.LC_ALL ?? process.env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale,
  )
  console.error(
    zh
      ? 'dramai: 无法启动：还没有构建。请先在仓库根目录运行 pnpm build'
      : 'dramai: cannot start: not built yet. Run pnpm build at the repository root first',
  )
  process.exit(1)
}
await import(entry.href)
