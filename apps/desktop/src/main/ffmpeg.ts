import { delimiter, join } from 'node:path'

/**
 * 从访达 / 开始菜单启动的应用拿不到用户 shell 里的 PATH（Homebrew 装的 ffmpeg 在 /opt/homebrew/bin，不在默认 PATH 里）。
 * 把常见的安装位置补到服务进程的 PATH 末尾，系统装了 ffmpeg 就能找到。
 */
export function commonToolDirs(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']
  if (platform === 'win32') {
    return [
      env.ProgramData ? join(env.ProgramData, 'chocolatey', 'bin') : '',
      env.USERPROFILE ? join(env.USERPROFILE, 'scoop', 'shims') : '',
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links') : '',
    ].filter(Boolean)
  }
  return ['/usr/local/bin', '/usr/bin', '/snap/bin']
}

export function withToolDirs(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string | undefined> {
  const key =
    platform === 'win32'
      ? (Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'Path')
      : 'PATH'
  const current = (env[key] ?? '').split(delimiter).filter(Boolean)
  const extra = commonToolDirs(platform, env).filter((d) => !current.includes(d))
  return { ...env, [key]: [...current, ...extra].join(delimiter) }
}
