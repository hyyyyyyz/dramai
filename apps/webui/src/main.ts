import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  DataDirLockedError,
  TokenRequiredError,
  createServer,
  type DramaiServer,
} from '@dramai/server'
import { parseCli, type Options } from './args.ts'
import { detectLang, messages, type Lang } from './messages.ts'
import { openBrowser } from './open-browser.ts'

export interface Io {
  out: (line: string) => void
  err: (line: string) => void
}

/** 随仓库构建的工作台：@dramai/workspace/dist。 */
export function defaultStaticDir(): string {
  const require = createRequire(import.meta.url)
  return join(dirname(require.resolve('@dramai/workspace/package.json')), 'dist')
}

function version(): string {
  const pkg = new URL('../package.json', import.meta.url)
  return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version
}

/** 把启动失败翻成一行人话。按错误类型 / 错误码判断，不看文案。 */
export function explainStartupError(
  err: unknown,
  options: Pick<Options, 'port' | 'host' | 'dataDir'>,
  lang: Lang,
): string {
  const m = messages[lang]
  if (err instanceof TokenRequiredError) return m.tokenRequired(options.host)
  if (err instanceof DataDirLockedError) return m.dataDirLocked(options.dataDir)
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EADDRINUSE') return m.portInUse(options.port)
  return err instanceof Error ? err.message : String(err)
}

export interface Running {
  server: DramaiServer
  url: string
  stop: () => Promise<void>
}

/** 浏览器要打开的地址：监听 0.0.0.0 / :: 时用 localhost；有令牌就带上（服务端种 cookie 后跳转去掉它）。 */
export function openUrl(serverUrl: string, token: string | undefined): string {
  const u = new URL(serverUrl)
  if (u.hostname === '0.0.0.0' || u.hostname === '[::]' || u.hostname === '::')
    u.hostname = 'localhost'
  return token ? `${u.origin}/?token=${encodeURIComponent(token)}` : u.origin
}

/**
 * 启动：解析参数 → 起服务（托管构建好的工作台）→ 打印地址 → 打开浏览器。
 * 返回退出码；启动失败只打印一行原因并返回非零。`running` 回调拿到句柄，由调用方负责在信号上停止它。
 */
export async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  io: Io,
  hooks: { onRunning?: (r: Running) => void; open?: typeof openBrowser } = {},
): Promise<number> {
  const lang = detectLang(env)
  const m = messages[lang]
  const parsed = parseCli(argv, env, m)
  if (parsed.kind === 'help') {
    io.out(m.help)
    return 0
  }
  if (parsed.kind === 'version') {
    io.out(version())
    return 0
  }
  const fail = (msg: string) => {
    io.err(`dramai: ${m.cannotStart}${msg}`)
    return 1
  }
  if (parsed.kind === 'error') return fail(parsed.message)

  const { options } = parsed
  const staticDir = options.staticDir ?? defaultStaticDir()
  if (!existsSync(join(staticDir, 'index.html'))) return fail(m.noStatic(staticDir))

  let server: DramaiServer
  try {
    server = await createServer({
      dataDir: options.dataDir,
      host: options.host,
      port: options.port,
      token: options.token,
      staticDir,
      version: version(),
      logger: { error: (...a) => io.err(a.map(String).join(' ')) },
    })
  } catch (err) {
    return fail(explainStartupError(err, options, lang))
  }

  const running: Running = {
    server,
    url: server.url,
    stop: () => server.close(),
  }
  io.out(`dramai ${version()}  ${m.started}`)
  io.out(`  ${m.address}  ${server.url}`)
  io.out(`  ${m.dataDir}  ${options.dataDir}`)
  const target = openUrl(server.url, options.token)
  if (options.token) io.out(`  ${m.tokenOpen}\n    ${target}`)
  io.out(`  ${m.stopHint}`)
  hooks.onRunning?.(running)

  if (options.open) {
    const ok = await (hooks.open ?? openBrowser)(target)
    if (!ok) io.err(`dramai: ${m.openFailed}`)
  }
  return 0
}
