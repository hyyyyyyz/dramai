// 驱动一个正在运行的 Electron 应用的极小 CDP 客户端（只用 Node 自带的 WebSocket，不加依赖）。
// 用它做冒烟检查和打包产物的流程验证；应用本身没有为此留任何后门，只用了 Chromium 的 --remote-debugging-port 开关。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(
  fn,
  { timeoutMs = 30_000, intervalMs = 200, what = 'condition' } = {},
) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (err) {
      lastError = err
    }
    await sleep(intervalMs)
  }
  throw new Error(`timed out waiting for ${what}${lastError ? ` (${lastError.message})` : ''}`)
}

/** 启动应用（源码形态：electron . ；打包形态：可执行文件），返回句柄。 */
export async function launch({ command, args = [], env = {}, userDataDir, cwd }) {
  await mkdir(userDataDir, { recursive: true })
  await rm(join(userDataDir, 'DevToolsActivePort'), { force: true })
  const child = spawn(
    command,
    [...args, `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0'],
    {
      cwd,
      env: { ...process.env, ...env, ELECTRON_ENABLE_LOGGING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  const exit = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal })),
  )
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => (output += d))
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const port = await waitFor(
    async () =>
      existsSync(portFile) ? Number((await readFile(portFile, 'utf8')).split('\n')[0]) : 0,
    { what: 'DevToolsActivePort', timeoutMs: 30_000 },
  )
  return { child, port, exit, output: () => output }
}

export async function pageTarget(port, urlPrefix = 'http://') {
  return waitFor(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      return list.find((t) => t.type === 'page' && t.url.startsWith(urlPrefix))
    },
    { what: 'app page', timeoutMs: 60_000 },
  )
}

export async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('cannot connect to the debugging socket'))
  })
  let nextId = 1
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  /** 在页面里执行表达式（支持 await），返回 JSON 值。 */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const screenshot = async () =>
    Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  return { send, evaluate, screenshot, close: () => ws.close() }
}

/** 在页面里调接口（同源，令牌由主进程补，页面和这里都看不到它）。 */
export const apiCall = (page, method, path, body) =>
  page.evaluate(`(async () => {
    const res = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: ${body === undefined ? '{}' : `{ 'content-type': 'application/json' }`},
      body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
    })
    const text = await res.text()
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { status: res.status, body: json }
  })()`)

export async function terminate(app, signal = 'SIGTERM', timeoutMs = 20_000) {
  app.child.kill(signal)
  return Promise.race([app.exit, sleep(timeoutMs).then(() => ({ timeout: true }))])
}
