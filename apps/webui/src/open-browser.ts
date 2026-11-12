import { spawn } from 'node:child_process'

/**
 * The command that opens a URL in the default browser. On Windows this deliberately avoids `cmd /c start`: cmd
 * re-parses the line, so `%…%` (and `&`, `^`) in a URL, such as a percent-encoded token, can be expanded or split.
 * `rundll32 url.dll,FileProtocolHandler` takes the URL as one argument and involves no shell.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]]
  return ['xdg-open', [url]]
}

/** 用系统默认浏览器打开地址。失败不致命（返回 false，调用方提示手动打开）。 */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const [cmd, args] = browserCommand(url, platform)
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
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
