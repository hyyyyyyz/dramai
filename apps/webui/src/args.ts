import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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

  const dataDir = resolve(
    cwd,
    (values['data-dir'] as string | undefined) ?? env.DRAMAI_DATA_DIR ?? join(homedir(), '.dramai'),
  )
  const staticDir = values['static-dir'] ? resolve(cwd, values['static-dir'] as string) : undefined
  return {
    kind: 'run',
    options: { port, host, dataDir, token, open: !values['no-open'], staticDir },
  }
}
