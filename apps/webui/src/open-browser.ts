import { spawn } from 'node:child_process'

/** 用系统默认浏览器打开地址。失败不致命（返回 false，调用方提示手动打开）。 */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const [cmd, args]: [string, string[]] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]]
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        stdio: 'ignore',
        detached: true,
        windowsVerbatimArguments: platform === 'win32',
      })
      child.on('error', () => resolve(false))
      child.on('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}
