import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { isLangPreference } from './strings.ts'
import type { LangPreference } from './strings.ts'

/** 桌面端自己的偏好（不是业务数据）。存在 userData 下的一个小 JSON 文件里。 */
export interface DesktopConfig {
  /** 用户选的数据目录；没有就用默认位置。 */
  dataDir?: string
  /** 上次成功使用的端口。下次优先用它（端口不变，页面的 localStorage 才能跨启动保留）；被占用就换一个。 */
  port?: number
  /** 启动时检查 GitHub Releases 有没有新版本。 */
  checkForUpdates: boolean
  /** 用户选了“跳过此版本”的版本号。 */
  skippedVersion?: string
  /** 上次检查更新的时间（毫秒）。 */
  lastUpdateCheck?: number
  /** 已经提示过“没有系统加密，密钥以文件权限保护”。 */
  plainSecretsNoticeShown?: boolean
  /** 用户选了“不再提醒”：没有找到 ffmpeg。 */
  ffmpegNoticeDismissed?: boolean
  /** 界面语言（原生菜单和对话框）；`auto` 跟随系统。网页界面的语言由前端设置页决定，两边通过桥接保持一致。 */
  language?: LangPreference
  window?: { width: number; height: number; maximized: boolean }
}

export const DEFAULT_CONFIG: DesktopConfig = { checkForUpdates: true }

export class ConfigStore {
  private data: DesktopConfig
  private readonly file: string

  constructor(file: string) {
    this.file = file
    this.data = this.read()
  }

  private read(): DesktopConfig {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<DesktopConfig>
      return { ...DEFAULT_CONFIG, ...sanitize(parsed) }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  get(): Readonly<DesktopConfig> {
    return this.data
  }

  update(patch: Partial<DesktopConfig>): void {
    const next = { ...this.data, ...patch }
    for (const key of Object.keys(next) as Array<keyof DesktopConfig>) {
      if (next[key] === undefined) delete next[key]
    }
    this.data = next
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, this.file)
  }
}

/** 只留类型对的字段：配置文件被手改坏了也不会让应用起不来。 */
function sanitize(raw: Partial<DesktopConfig>): Partial<DesktopConfig> {
  const out: Partial<DesktopConfig> = {}
  if (typeof raw.dataDir === 'string' && raw.dataDir) out.dataDir = raw.dataDir
  if (Number.isInteger(raw.port) && raw.port! > 0 && raw.port! < 65536) out.port = raw.port
  if (typeof raw.checkForUpdates === 'boolean') out.checkForUpdates = raw.checkForUpdates
  if (typeof raw.skippedVersion === 'string') out.skippedVersion = raw.skippedVersion
  if (Number.isFinite(raw.lastUpdateCheck)) out.lastUpdateCheck = raw.lastUpdateCheck
  if (typeof raw.plainSecretsNoticeShown === 'boolean')
    out.plainSecretsNoticeShown = raw.plainSecretsNoticeShown
  if (typeof raw.ffmpegNoticeDismissed === 'boolean')
    out.ffmpegNoticeDismissed = raw.ffmpegNoticeDismissed
  if (isLangPreference(raw.language)) out.language = raw.language
  const w = raw.window
  if (
    w &&
    Number.isFinite(w.width) &&
    Number.isFinite(w.height) &&
    typeof w.maximized === 'boolean'
  )
    out.window = { width: w.width, height: w.height, maximized: w.maximized }
  return out
}
