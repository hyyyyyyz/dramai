// 桌面端构建产物的命名约定：dramai-<版本>-<系统>-<架构>.<扩展名>
// 例：dramai-0.5.0-mac-arm64.dmg、dramai-0.5.0-beta.1-win-x64.exe
// 这里负责从 electron-builder 的输出目录里挑出符合约定的安装包。
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type PlatformFamily = 'mac' | 'win' | 'linux'
export type Arch = 'arm64' | 'x64'

/** 约定里“系统”一段的写法没有定死，这里接受常见别名，桌面端定下来之后可以收紧。 */
const OS_TOKENS: Record<PlatformFamily, string[]> = {
  mac: ['mac', 'macos', 'darwin'],
  win: ['win', 'windows'],
  linux: ['linux'],
}

const EXTENSIONS = ['dmg', 'zip', 'exe', 'msi', 'AppImage', 'deb', 'rpm', 'tar.gz']

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function installerPattern(version: string, family: PlatformFamily, arch: Arch): RegExp {
  const os = OS_TOKENS[family].map(escapeRegExp).join('|')
  const ext = EXTENSIONS.map(escapeRegExp).join('|')
  return new RegExp(`^dramai-${escapeRegExp(version)}-(?:${os})-${arch}\\.(?:${ext})$`)
}

export interface CollectResult {
  /** 符合约定、已复制到 out 的文件名 */
  collected: string[]
  /** 以 dramai- 开头但不符合约定的文件（不会上传，调用方应该提示） */
  ignored: string[]
}

/** 把 dir 里符合约定的安装包复制到 out；一个都没有时抛错。 */
export function collectAssets(options: {
  dir: string
  out: string
  version: string
  family: PlatformFamily
  arch: Arch
}): CollectResult {
  const { dir, out, version, family, arch } = options
  const pattern = installerPattern(version, family, arch)
  const collected: string[] = []
  const ignored: string[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith('dramai-') || !statSync(join(dir, name)).isFile()) continue
    if (pattern.test(name)) collected.push(name)
    // electron-builder's differential-update maps: expected next to the installers, never uploaded, no warning
    else if (!name.endsWith('.blockmap')) ignored.push(name)
  }
  if (collected.length === 0) {
    throw new Error(
      `No installer named dramai-${version}-<${OS_TOKENS[family].join('|')}>-${arch}.<${EXTENSIONS.join('|')}> found in ${dir}` +
        (ignored.length > 0
          ? ` (saw: ${ignored.join(', ')})`
          : ' (the directory has no dramai-* files)'),
    )
  }
  mkdirSync(out, { recursive: true })
  for (const name of collected) copyFileSync(join(dir, name), join(out, name))
  return { collected, ignored }
}
