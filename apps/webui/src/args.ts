import { homedir } from 'node:os'
import { isAbsolute, join, posix, resolve, sep, win32 } from 'node:path'
import { parseArgs } from 'node:util'
import type { messages as Messages } from './messages.ts'

export interface Options {
  port: number
  host: string
  dataDir: string
  token: string | undefined
  open: boolean
  staticDir: string | undefined
}

export type Parsed =
  | { kind: 'run'; options: Options }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string }

const MIN_TOKEN = 16
export const DEFAULT_PORT = 8787

/**
 * The path operations the launcher uses, so the Windows rules (drive letters, backslashes, UNC paths, `~\`) can be
 * tested on any machine with `win32Paths()`. The real launcher always uses `nativePaths()`.
 */
export interface PathOps {
  resolve: (...parts: string[]) => string
  join: (...parts: string[]) => string
  isAbsolute: (p: string) => boolean
  sep: string
  home: string
}
export const nativePaths = (): PathOps => ({ resolve, join, isAbsolute, sep, home: homedir() })
export const win32Paths = (home: string): PathOps => ({ ...win32, sep: win32.sep, home })
export const posixPaths = (home: string): PathOps => ({ ...posix, sep: posix.sep, home })

/**
 * A leading `~` means the home directory. POSIX shells expand it before we see it; cmd.exe and PowerShell do not,
 * so `--data-dir ~\dramai` arrives literally and would create a folder named `~` in the current directory.
 */
export function expandHome(p: string, paths: PathOps): string {
  if (p === '~') return paths.home
  if (p.startsWith('~/') || (paths.sep === '\\' && p.startsWith('~\\')))
    return paths.join(paths.home, p.slice(2))
  return p
}

export function isLoopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' ||
    h === '::1' ||
    h === '127.0.0.1' ||
    /^127\.\d+\.\d+\.\d+$/.test(h) ||
    h.endsWith('.localhost')
  )
}

/**
 * 命令行 + 环境变量 → 选项。命令行优先。不做任何副作用（不碰文件、不起服务），方便测试。
 * 非回环地址必须有令牌：这里先拦一道（给出清楚的提示），服务端启动时还会再拦一次。
 */
export function parseCli(
  argv: string[],
  env: Record<string, string | undefined>,
  m: (typeof Messages)['zh'],
  cwd = process.cwd(),
  paths: PathOps = nativePaths(),
): Parsed {
  let values: Record<string, string | boolean | undefined>
  try {
    values = parseArgs({
      args: argv,
      options: {
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        'data-dir': { type: 'string' },
        token: { type: 'string' },
        'no-open': { type: 'boolean' },
        open: { type: 'boolean' },
        'static-dir': { type: 'string' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (err) {
    return {
      kind: 'error',
      message: m.unknownOption(err instanceof Error ? err.message : String(err)),
    }
  }
  if (values.help) return { kind: 'help' }
  if (values.version) return { kind: 'version' }

  const portText = (values.port as string | undefined) ?? env.DRAMAI_PORT
  let port = DEFAULT_PORT
  if (portText !== undefined && portText !== '') {
    const n = Number(portText)
    if (!/^\d+$/.test(portText) || !Number.isInteger(n) || n < 0 || n > 65535)
      return { kind: 'error', message: m.badOption('--port', portText, m.hintPort) }
    port = n
  }

  const host = ((values.host as string | undefined) ?? env.DRAMAI_HOST ?? '127.0.0.1').trim()
  const rawToken = ((values.token as string | undefined) ?? env.DRAMAI_TOKEN)?.trim()
  const token = rawToken === '' ? undefined : rawToken
  if (token !== undefined && token.length < MIN_TOKEN)
    return { kind: 'error', message: m.tokenTooShort }
  if (!isLoopback(host) && token === undefined)
    return { kind: 'error', message: m.tokenRequired(host) }

  const dataDir = paths.resolve(
    cwd,
    expandHome(
      (values['data-dir'] as string | undefined) ??
        env.DRAMAI_DATA_DIR ??
        paths.join(paths.home, '.dramai'),
      paths,
    ),
  )
  const staticDir = values['static-dir']
    ? paths.resolve(cwd, expandHome(values['static-dir'] as string, paths))
    : undefined
  return {
    kind: 'run',
    options: { port, host, dataDir, token, open: !values['no-open'], staticDir },
  }
}
