import { messages, detectLang } from './messages.ts'
import { run, type Running } from './main.ts'

let running: Running | undefined
let stopping = false

async function stop() {
  if (stopping) return
  stopping = true
  console.log(messages[detectLang(process.env)].stopping)
  try {
    await running?.stop()
  } finally {
    process.exit(0)
  }
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
// Windows: closing the console window and Ctrl+Break arrive as SIGBREAK, not SIGTERM; stop cleanly so the data
// directory lock is released.
if (process.platform === 'win32') process.on('SIGBREAK', () => void stop())

const code = await run(
  process.argv.slice(2),
  process.env,
  {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
  },
  { onRunning: (r) => (running = r) },
)

// 帮助 / 版本 / 启动失败：直接退出；启动成功：保持运行，等信号。
if (!running) process.exit(code)
