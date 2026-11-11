import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createServer } from './app.ts'

/**
 * 开发入口：`pnpm --filter @dramai/server dev`。
 * 环境变量：DRAMAI_DATA_DIR（默认 ~/.dramai-dev）、PORT（默认 8787）、HOST（默认 127.0.0.1）、
 * DRAMAI_TOKEN（非回环地址必填；回环下不设则不启用）、DRAMAI_STATIC_DIR（托管前端构建产物）。
 */
const host = process.env.HOST ?? '127.0.0.1'
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
const token =
  process.env.DRAMAI_TOKEN ?? (loopback ? undefined : randomBytes(24).toString('base64url'))

function fail(err: unknown): never {
  // 启动失败是“预期内的错误”（数据目录被占用、非回环没有 token……）：一行原因 + 非零退出，不打调用栈。
  const message = err instanceof Error ? err.message : String(err)
  console.error(`dramai: 无法启动：${message}`)
  process.exit(1)
}

const server = await createServer({
  dataDir: process.env.DRAMAI_DATA_DIR ?? join(homedir(), '.dramai-dev'),
  host,
  port: Number(process.env.PORT ?? 8787),
  token,
  staticDir: process.env.DRAMAI_STATIC_DIR,
  logger: console,
}).catch(fail)

console.log(`dramai server  ${server.url}`)
console.log(`data dir       ${server.ctx.config.dataDir}`)
if (token) console.log(`open with      ${server.url}/?token=${token}`)

let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true
  await server.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
