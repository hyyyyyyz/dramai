/**
 * 主进程 ↔ 服务进程（Electron utilityProcess）之间的消息。
 *
 * 令牌、密钥明文只走这条进程间通道：不进环境变量、不进命令行参数（`ps` 看得到）、不写日志。
 */

export type StartFailureCode =
  | 'DATA_DIR_LOCKED'
  | 'TOKEN_REQUIRED'
  | 'PORT_IN_USE'
  | 'SCHEMA_TOO_NEW'
  | 'UNKNOWN'

export interface ServerStartOptions {
  dataDir: string
  /** 0 = 系统分配。 */
  port: number
  token: string
  /** 前端构建产物目录；开发形态（窗口加载 Vite）时可以不给。 */
  staticDir?: string
  version: string
  /** 显式的 ffmpeg / ffprobe 路径（内置二进制）；不给就让服务按环境变量和 PATH 找。 */
  ffmpegPath?: string
  ffprobePath?: string
  /** 演示模式的提示语（只让界面显示横幅，服务行为不变）。 */
  demoNotice?: { zh: string; en: string }
}

export type SecretOp = 'get' | 'set' | 'delete' | 'has'

export type HostToServer =
  | { type: 'start'; options: ServerStartOptions }
  | { type: 'stop'; graceful: boolean }
  | {
      type: 'secret.result'
      id: number
      ok: boolean
      value?: string | boolean | null
      error?: string
    }

export type ServerToHost =
  | { type: 'ready'; url: string; port: number }
  | { type: 'start.failed'; code: StartFailureCode; message: string }
  | { type: 'stopped' }
  | { type: 'secret.request'; id: number; op: SecretOp; ref: string; value?: string }
  | { type: 'log'; level: 'info' | 'error'; text: string }

/** 把服务启动抛出的错误归类。按错误名 / 系统错误码判断，不看（中文）文案。 */
export function classifyStartError(err: unknown): StartFailureCode {
  const name = err instanceof Error ? err.name : ''
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (name === 'DataDirLockedError') return 'DATA_DIR_LOCKED'
  if (name === 'TokenRequiredError') return 'TOKEN_REQUIRED'
  if (name === 'SchemaTooNewError') return 'SCHEMA_TOO_NEW'
  if (code === 'EADDRINUSE') return 'PORT_IN_USE'
  return 'UNKNOWN'
}
