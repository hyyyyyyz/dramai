import { isAbsolute, join, resolve } from 'node:path'

export interface DataDirInput {
  env: Record<string, string | undefined>
  /** 用户在菜单里选过的目录。 */
  configured?: string
  /** Electron 的 userData（各系统的应用数据目录下的应用文件夹）。 */
  userData: string
}

/**
 * 数据目录：环境变量 DRAMAI_DATA_DIR（显式指定，最优先）> 用户在“更改数据目录”里选的 > 应用数据目录下的 `data`。
 * 默认位置：macOS `~/Library/Application Support/Dramai/data`、Windows `%APPDATA%\Dramai\data`、Linux `~/.config/Dramai/data`。
 */
export function resolveDataDir(input: DataDirInput): {
  dir: string
  source: 'env' | 'config' | 'default'
} {
  const fromEnv = input.env.DRAMAI_DATA_DIR?.trim()
  if (fromEnv) return { dir: absolute(fromEnv), source: 'env' }
  if (input.configured) return { dir: absolute(input.configured), source: 'config' }
  return { dir: join(input.userData, 'data'), source: 'default' }
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(path)
}
