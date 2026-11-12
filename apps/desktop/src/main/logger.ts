import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Log = (level: 'info' | 'error', text: string) => void

const MAX_BYTES = 2 * 1024 * 1024

/** 追加写入 `<logsDir>/main.log`（启动时超过 2MB 就换成 main.old.log）。不记录令牌和密钥——调用方不会把它们传进来。 */
export function createFileLogger(logsDir: string): Log {
  const file = join(logsDir, 'main.log')
  try {
    mkdirSync(logsDir, { recursive: true })
    if (statSync(file).size > MAX_BYTES) renameSync(file, join(logsDir, 'main.old.log'))
  } catch {
    /* 日志文件还不存在，或目录不可写：下面的写入会各自忽略失败 */
  }
  return (level, text) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${text}\n`
    try {
      appendFileSync(file, line)
    } catch {
      /* 写不了日志不能让应用挂掉 */
    }
    if (level === 'error') console.error(text)
    else console.log(text)
  }
}
