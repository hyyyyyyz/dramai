import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 数据目录锁。同一个数据目录同时只能有一个服务实例（SQLite 的写入、任务调度、文件夹都假定独占）。
 * `dramai.lock` 用 `wx`（排他创建）写入 pid；已存在时看那个 pid 还活着没有：活着就报错，死了就接管。
 */
export class DataDirLockedError extends Error {
  readonly pid?: number
  readonly lockFile: string
  constructor(lockFile: string, pid?: number, since?: number) {
    super(
      `数据目录已被另一个 dramai 实例占用${pid ? `（进程 ${pid}${since ? `，自 ${new Date(since).toLocaleString()}` : ''}）` : ''}。` +
        `请先关闭它；如果确认没有其他实例在运行，删除 ${lockFile} 后重试。`,
    )
    this.name = 'DataDirLockedError'
    this.pid = pid
    this.lockFile = lockFile
  }
}

export interface DataDirLock {
  readonly file: string
  release(): Promise<void>
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' // 存在但不属于我们
  }
}

export async function acquireDataDirLock(dataDir: string): Promise<DataDirLock> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const file = join(dataDir, 'dramai.lock')
  const body = JSON.stringify({ pid: process.pid, startedAt: Date.now() })

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fh = await open(file, 'wx', 0o600)
      await fh.writeFile(body)
      await fh.close()
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let info: { pid?: number; startedAt?: number } = {}
      try {
        info = JSON.parse(await readFile(file, 'utf8')) as typeof info
      } catch {
        /* 内容损坏或正在被写：按陌生锁处理 */
      }
      if (info.pid && alive(info.pid)) throw new DataDirLockedError(file, info.pid, info.startedAt)
      if (attempt === 2) throw new DataDirLockedError(file, info.pid, info.startedAt)
      await unlink(file).catch(() => {}) // 陈旧锁：接管后重试
    }
  }

  let released = false
  const onExit = () => {
    if (released) return
    try {
      unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
  process.once('exit', onExit)
  return {
    file,
    async release() {
      if (released) return
      released = true
      process.removeListener('exit', onExit)
      try {
        const info = JSON.parse(await readFile(file, 'utf8')) as { pid?: number }
        if (info.pid === process.pid) await unlink(file)
      } catch {
        /* 已经不在了 */
      }
    },
  }
}
