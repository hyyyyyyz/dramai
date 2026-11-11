#!/usr/bin/env node
// 开发循环：一条命令同时起本地服务和前端开发服务器（/api 由 vite 代理到服务）。
//
//   pnpm dev                    正式服务（数据目录 ~/.dramai-dev，环境变量见 packages/server/src/dev.ts）
//   pnpm dev:demo [-- 选项]     演示服务（模拟服务商，不花钱）；选项原样交给 `pnpm demo`，如 --fresh --fail-rate 0.3
//
// 服务就绪（/api/health 通了）再启动 vite，避免页面一打开就连不上。
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const demo = args.includes('--demo')
const passthrough = args.filter((a) => a !== '--demo' && a !== '--')
const root = fileURLToPath(new URL('../../..', import.meta.url))
const apiPort = process.env.PORT ?? '8787'
const api = process.env.DRAMAI_API ?? `http://127.0.0.1:${apiPort}`

const children = []
function run(label, command, argv, env = {}) {
  const child = spawn(command, argv, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`[${label}] ${line}`))
  }
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${label}] 退出了（${signal ?? code}），一起停止`)
      stop(code ?? 1)
    }
  })
  children.push(child)
  return child
}

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

async function waitForApi(timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${api}/api/health`)
      if (res.ok) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

if (demo) {
  run('server', 'pnpm', ['--filter', '@dramai/mock-providers', 'demo', ...passthrough])
} else {
  run('server', 'pnpm', ['--filter', '@dramai/server', 'dev'])
}

if (!(await waitForApi())) {
  console.error(`本地服务 30 秒内没有就绪（${api}），请看上面 [server] 的输出`)
  stop(1)
} else {
  run('web', 'pnpm', ['--filter', '@dramai/workspace', 'dev:web'], { DRAMAI_API: api })
  console.log(`\n  前端  http://localhost:5173    服务  ${api}${demo ? '    （演示模式）' : ''}\n`)
}
