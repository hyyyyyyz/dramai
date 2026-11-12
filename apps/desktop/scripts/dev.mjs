#!/usr/bin/env node
// 从源码运行桌面应用：  pnpm desktop:dev [--demo] [--fresh] [-- <传给 electron 的参数>]
//
//   1. 监听构建主进程 / 预加载 / 服务进程（改了源码会自动重新打包并重启应用）
//   2. 启动前端开发服务器（热更新照常可用；/api 由它代理到应用内的本地服务）
//   3. 启动 Electron：窗口加载前端开发服务器，服务进程用的是和正式包同一份打包产物（从源码构建）
//
//   --demo    同时起模拟服务商并预先建好服务商配置：不需要任何 API Key，不花钱（占位内容）
//   --fresh   （配合 --demo）先清空演示数据目录
import { spawn } from 'node:child_process'
import { existsSync, statSync, watch } from 'node:fs'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { ensureDevApp } from './lib/dev-app.mjs'
import { createServer } from 'node:net'

const root = fileURLToPath(new URL('..', import.meta.url))
const repo = join(root, '../..')
const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const ownArgs = sep >= 0 ? argv.slice(0, sep) : argv
const electronArgs = sep >= 0 ? argv.slice(sep + 1) : []
const demo = ownArgs.includes('--demo')
const fresh = ownArgs.includes('--fresh')

const children = new Set()
let stopping = false
function spawnLogged(label, command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`[${label}] ${line}`))
  }
  children.add(child)
  child.on('exit', () => children.delete(child))
  return child
}
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  setTimeout(() => process.exit(code), 1500).unref()
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}
async function waitHttp(url, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).status < 500) return true
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// 电子二进制：pnpm 的安装脚本被跳过时补一次下载。
const require = createRequire(import.meta.url)
const electronPkg = join(root, 'node_modules/electron')
if (!existsSync(join(electronPkg, 'path.txt'))) {
  console.log('[desktop] downloading the Electron binary…')
  await new Promise((resolve, reject) =>
    spawn('node', ['install.js'], { cwd: electronPkg, stdio: 'inherit' }).on('exit', (c) =>
      c === 0 ? resolve() : reject(new Error('electron install failed')),
    ),
  )
}
const electronBin = ensureDevApp()

// 前端的构建产物只有“打包形态”才需要；开发形态窗口加载 Vite。
const build = spawnLogged('build', 'node', ['scripts/build.mjs', '--watch', '--no-web'], {
  cwd: root,
})
await new Promise((resolve) => {
  build.stdout.on('data', (d) => String(d).includes('watching') && resolve())
  build.on('exit', resolve)
})

const apiPort = await freePort()
const webPort = await freePort()
const webUrl = `http://127.0.0.1:${webPort}`
const env = { ...process.env, FORCE_COLOR: '1' }

spawnLogged(
  'web',
  'pnpm',
  ['exec', 'vite', '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'],
  {
    cwd: join(repo, 'packages/workspace'),
    env: { ...env, DRAMAI_API: `http://127.0.0.1:${apiPort}` },
  },
)

const appEnv = {
  ...env,
  DRAMAI_DESKTOP_DEV_URL: webUrl,
  DRAMAI_DESKTOP_SERVER_PORT: String(apiPort),
}
if (demo) {
  const mockPort = await freePort()
  const dataDir = join(homedir(), '.dramai-desktop-demo')
  if (fresh) await rm(dataDir, { recursive: true, force: true })
  spawnLogged(
    'mock',
    'node',
    [
      '--conditions=dramai-source',
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      'scripts/mock-providers.mjs',
      String(mockPort),
    ],
    { cwd: root, env },
  )
  if (!(await waitHttp(`http://127.0.0.1:${mockPort}/`)))
    console.warn('[desktop] mock providers did not answer')
  appEnv.DRAMAI_DESKTOP_DEMO_MOCK = `http://127.0.0.1:${mockPort}`
  appEnv.DRAMAI_DATA_DIR ??= dataDir
  console.log(`\n  演示模式 · demo mode: nothing is charged; data in ${appEnv.DRAMAI_DATA_DIR}\n`)
}

if (!(await waitHttp(webUrl))) {
  console.error('[desktop] the frontend dev server did not start')
  stop(1)
}

let app
function startApp() {
  app = spawnLogged('app', electronBin, ['.', ...electronArgs], { cwd: root, env: appEnv })
  const current = app
  app.on('exit', (code) => {
    if (current !== app || restarting) return
    console.log(`[desktop] app exited (${code})`)
    stop(0)
  })
}
let restarting = false
let timer
function restart() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    restarting = true
    const old = app
    old.once('exit', () => {
      restarting = false
      console.log('[desktop] source changed → restarting the app')
      startApp()
    })
    old.kill('SIGTERM')
  }, 600)
}
startApp()
// 文件内容真的变了（修改时间变了）才重启；监听器自己的重复事件不算。
for (const file of ['main.js', 'preload.cjs', 'server/server.mjs']) {
  const path = join(root, 'dist', file)
  let seen = statSync(path).mtimeMs
  watch(path, () => {
    if (stopping || !app) return
    try {
      const now = statSync(path).mtimeMs
      if (now === seen) return
      seen = now
      restart()
    } catch {
      /* 文件正在被重写 */
    }
  })
}
