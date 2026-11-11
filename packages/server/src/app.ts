import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import type { Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createAdaptorServer } from '@hono/node-server'
import {
  bundledDataDir,
  createPipelineHandlers,
  createProviderLlm,
  JobFailure,
  JobQueue,
  JobWorker,
  loadCatalog,
  locateFfmpeg,
  probeCapabilities,
  recoverRunningJobs,
} from '@dramai/core'
import type {
  Clock,
  ExecutorDeps,
  IdGenerator,
  JobHandler,
  LlmClient,
  LocateOptions,
  PipelineDeps,
  SecretStore,
} from '@dramai/core'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ServerContext, FfmpegState } from './context.ts'
import { DomainError } from '@dramai/core'
import { fromDomainError, HttpError } from './errors.ts'
import { EventBus } from './events/event-bus.ts'
import { RouteRegistry, stubMissing } from './handle.ts'
import { staticFiles } from './http/static.ts'
import { acquireDataDirLock } from './lock.ts'
import { registerAssetRoutes } from './routes/assets.ts'
import { registerEventRoutes } from './routes/events.ts'
import { registerFileRoutes } from './routes/files.ts'
import { registerJobRoutes } from './routes/jobs.ts'
import { registerProjectRoutes } from './routes/projects.ts'
import { registerSystemRoutes } from './routes/system.ts'
import { createSecurity } from './security.ts'
import { FileSecretStore } from './secrets.ts'
import type { SecretCipher } from './secrets.ts'
import { ProviderService } from './services/providers.ts'
import { SettingsService } from './services/settings.ts'
import { FsFileStore } from './storage/files.ts'
import { openSqliteStore } from './storage/sqlite-store.ts'

export interface CreateServerOptions {
  /** 数据目录：数据库、项目文件夹、密钥文件、用户覆盖的提示词 / 模型数据都在这里。 */
  dataDir: string
  /** 监听端口；0 = 系统分配（实际端口见返回值）。 */
  port?: number
  /** 监听地址，默认 127.0.0.1。非回环地址必须提供 token。 */
  host?: string
  /** 前端构建产物目录（可选）；提供后由本服务一并托管。 */
  staticDir?: string
  /** 访问令牌。桌面版每次启动随机生成；监听非回环地址时必填。 */
  token?: string
  /** 额外允许的 Host 头主机名（反向代理的域名）。 */
  allowedHosts?: string[]
  version?: string
  desktop?: boolean
  /** 演示模式标记：只用于让界面显示提示，服务端行为不因它改变。 */
  demo?: { notice: string }

  // —— 可替换的实现 / 测试注入 ——
  /** 密钥存储（桌面版换成系统加密 / 钥匙串）。 */
  secretStore?: SecretStore
  /** 或只提供一个加解密器，仍用默认的文件存放。 */
  secretCipher?: SecretCipher
  ffmpeg?: LocateOptions
  /** 调服务商用的 fetch / sleep（测试里换假的）。 */
  executor?: ExecutorDeps
  /** 直接替换 LLM 客户端（测试）。缺省按“任务冻结的 / 当前选中的”LLM 服务商调用。 */
  llm?: LlmClient
  clock?: Clock
  ids?: IdGenerator
  /** 额外的任务处理器（测试）。 */
  extraHandlers?: Record<string, JobHandler>
  /** 响应也按契约校验（测试开；生产关）。 */
  validateResponses?: boolean
  /** 不启动 worker（只想测接口时）。 */
  startWorker?: boolean
  workerIntervalMs?: number
  lanes?: ConstructorParameters<typeof JobWorker>[0]['lanes']
  sseHeartbeatMs?: number
  logger?: { error(...args: unknown[]): void; info?(...args: unknown[]): void }
}

export interface DramaiServer {
  url: string
  host: string
  port: number
  token?: string
  app: Hono
  ctx: ServerContext
  /** 关闭。`graceful: false` 立刻中止在跑的任务（模拟崩溃 / 强退，重启后由恢复逻辑接管）。 */
  close(options?: { graceful?: boolean }): Promise<void>
}

/** 本包的真实版本（src 和 dist 都在包根下一层，所以相对路径相同）。 */
function packageVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url)
    return (JSON.parse(readFileSync(url, 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const realClock: Clock = { now: () => Date.now() }
const realIds: IdGenerator = {
  next: (prefix) => `${prefix}_${randomBytes(6).toString('hex')}`,
}

export interface JobTag {
  jobId: string
  operation: string
  providerConfigId?: string
}

/**
 * 启动顺序（计划 4.x）：数据目录锁 → 打开存储（建表 / 迁移）→ 文件 / 密钥 / 数据目录 → 恢复 running 任务 →
 * 注册处理器 → 启动 worker → 注册路由 → 监听。任何一步失败都会释放已获得的资源。
 */
export async function createServer(options: CreateServerOptions): Promise<DramaiServer> {
  const host = options.host ?? '127.0.0.1'
  const logger = options.logger ?? { error: (...a: unknown[]) => console.error(...a) }
  // 先校验安全配置：不满足就别动数据目录。
  const security = createSecurity({
    host,
    token: options.token,
    allowedHosts: options.allowedHosts,
  })

  const dataDir = options.dataDir
  const lock = await acquireDataDirLock(dataDir)
  let store: Awaited<ReturnType<typeof openSqliteStore>> | undefined
  let worker: JobWorker | undefined
  let bus: EventBus | undefined
  try {
    store = await openSqliteStore(join(dataDir, 'dramai.sqlite'))
    const files = new FsFileStore(dataDir)
    await mkdir(files.root, { recursive: true })
    const secrets = options.secretStore ?? new FileSecretStore(dataDir, options.secretCipher)
    const clock = options.clock ?? realClock
    const ids = options.ids ?? realIds
    bus = new EventBus()
    const catalog = loadCatalog({
      extraDirs: [join(dataDir, 'catalog')],
    })

    const ffmpeg: FfmpegState = {}
    try {
      ffmpeg.bins = await locateFfmpeg(options.ffmpeg)
      ffmpeg.caps = await probeCapabilities(ffmpeg.bins)
    } catch (err) {
      ffmpeg.error = err instanceof Error ? err.message : String(err)
    }

    const settings = new SettingsService(store)
    const providers = new ProviderService({
      store,
      secrets,
      settings,
      models: catalog.models,
      ids,
      clock,
      executor: options.executor,
    })
    const config = {
      dataDir,
      host,
      port: 0,
      version: options.version ?? packageVersion(),
      desktop: options.desktop ?? false,
      startedAt: clock.now(),
      tokenRequired: security.tokenRequired,
      demo: options.demo,
    }

    const jobTag = new AsyncLocalStorage<JobTag>()
    const activeProvider: ServerContext['activeProvider'] = async (kind) => {
      const id = settings.activeId(await settings.get(), kind)
      const cfg = id ? await store!.providers.get(id) : undefined
      return cfg?.enabled ? cfg : undefined
    }

    const deps: PipelineDeps = {
      store,
      files,
      secrets,
      clock,
      ids,
      events: bus,
      catalog,
      llm: undefined as never,
      providers: { get: (id) => store!.providers.get(id), list: () => store!.providers.list() },
      executor: options.executor,
      media: ffmpeg.bins && ffmpeg.caps ? { bins: ffmpeg.bins, caps: ffmpeg.caps } : undefined,
    }
    // LLM：按“当前任务提交时冻结的服务商”调用，没有就用当前选中的；流式增量通过总线推给前端。
    deps.llm =
      options.llm ??
      ({
        async complete(req) {
          const tag = jobTag.getStore()
          const cfg =
            (tag?.providerConfigId
              ? await store!.providers.get(tag.providerConfigId)
              : undefined) ?? (await activeProvider('llm'))
          if (!cfg) {
            throw new JobFailure({
              category: 'invalid_input',
              code: 'NO_LLM_PROVIDER',
              message: '还没有配置可用的大模型服务商：请先到「设置 → 服务商」添加并选中一个。',
              recoverable: false,
            })
          }
          const inner = createProviderLlm(deps, cfg)
          let chars = 0
          return inner.complete({
            ...req,
            onDelta: (delta) => {
              chars += delta.length
              if (tag) {
                bus!.textDelta({
                  jobId: tag.jobId,
                  operation: tag.operation,
                  task: req.task,
                  delta,
                  chars,
                })
              }
              req.onDelta?.(delta, '')
            },
          })
        },
      } satisfies LlmClient)

    const queue = new JobQueue({ jobs: store.jobs, clock, ids, events: bus })

    // 1. 恢复上次没有结局的任务（有上游任务号 → 续轮询；付费且无任务号 → 标记结果不明，绝不重投）。
    await recoverRunningJobs({
      jobs: store.jobs,
      clock,
      events: bus,
      listProviderConfigs: () => store!.providers.list(),
    })

    // 2. 注册处理器（文本类用 AsyncLocalStorage 记下当前任务，LLM 流式输出才知道推给谁）。
    const handlers: Record<string, JobHandler> = {}
    for (const [name, handler] of Object.entries({
      ...createPipelineHandlers(deps),
      ...options.extraHandlers,
    })) {
      handlers[name] = (ctx) =>
        jobTag.run(
          {
            jobId: ctx.job.id,
            operation: ctx.job.operation,
            providerConfigId: ctx.job.providerSnapshot?.providerConfigId,
          },
          () => handler(ctx),
        )
    }

    // 3. worker
    worker = new JobWorker({
      jobs: store.jobs,
      clock,
      events: bus,
      handlers,
      lanes: options.lanes,
      intervalMs: options.workerIntervalMs,
      recovery: { listProviderConfigs: () => store!.providers.list() },
      onError: (err) => {
        logger.error('[worker]', err)
        bus!.emit({
          type: 'job.worker_error',
          message: err instanceof Error ? err.message : String(err),
        })
      },
    })

    const ctx: ServerContext = {
      config,
      store,
      files,
      secrets,
      bus,
      clock,
      ids,
      catalog,
      deps,
      queue,
      worker,
      ffmpeg,
      settings,
      providers,
      activeProvider,
    }

    const app = new Hono()
    app.onError((err, c) => {
      if (err instanceof HttpError) return c.json(err.toBody(), err.status as never)
      if (err instanceof DomainError) {
        const mapped = fromDomainError(err)
        return c.json(mapped.toBody(), mapped.status as never)
      }
      if (err instanceof SyntaxError) {
        return c.json({ error: { code: 'BAD_REQUEST', message: '请求格式不合法' } }, 400)
      }
      logger.error('[http]', c.req.method, c.req.path, err)
      return c.json({ error: { code: 'INTERNAL', message: '服务内部错误' } }, 500)
    })
    app.notFound((c) =>
      c.json(
        { error: { code: 'NOT_FOUND', message: `没有这个接口：${c.req.method} ${c.req.path}` } },
        404,
      ),
    )

    // 安全边界：Host → Origin → token。不注册任何 CORS。
    app.use('*', security.hostGuard)
    app.use('*', security.originGuard)
    app.get('/api/health', (c) => c.json({ ok: true }))
    app.use('*', security.authGuard)
    app.use('/api/*', async (c, next) => {
      const multipart = (c.req.header('content-type') ?? '').startsWith('multipart/')
      return bodyLimit({
        maxSize: multipart ? 1024 * 1024 * 1024 : 8 * 1024 * 1024,
        onError: (c2) =>
          c2.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体太大' } }, 413),
      })(c, next)
    })
    app.use('*', async (c, next) => {
      await next()
      if (c.req.path.startsWith('/api/'))
        c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store')
    })

    const registry = new RouteRegistry(app, {
      validateResponses: options.validateResponses,
      store: { transaction: (fn) => store!.transaction(async () => fn()) },
    })
    registerSystemRoutes(registry, ctx)
    registerProjectRoutes(registry, ctx)
    registerAssetRoutes(registry, ctx)
    registerJobRoutes(registry, ctx)
    const openStreams = new Set<() => void>()
    registerFileRoutes(app, ctx)
    registerEventRoutes(app, ctx, openStreams, options.sseHeartbeatMs)
    const missing = stubMissing(registry, app)
    if (missing.length > 0) logger.info?.(`[server] ${missing.length} routes not implemented yet`)
    if (options.staticDir) app.use('*', staticFiles(options.staticDir))

    // 4. 监听
    const server = createAdaptorServer({ fetch: app.fetch })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 0, host, () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address() as AddressInfo
    config.port = address.port

    if (options.startWorker !== false) worker.start()

    let closed: Promise<void> | undefined
    const close: DramaiServer['close'] = (closeOptions = {}) => {
      closed ??= (async () => {
        for (const end of [...openStreams]) end()
        const httpServer = server as HttpServer
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve())
          httpServer.closeAllConnections()
        })
        await worker!.stop({ waitForActive: closeOptions.graceful !== false })
        bus!.dispose()
        store!.close()
        await lock.release()
      })()
      return closed
    }

    const hostForUrl = host.includes(':') ? `[${host}]` : host
    return {
      url: `http://${hostForUrl}:${address.port}`,
      host,
      port: address.port,
      token: options.token,
      app,
      ctx,
      close,
    }
  } catch (err) {
    await worker?.stop({ waitForActive: false }).catch(() => {})
    bus?.dispose()
    store?.close()
    await lock.release()
    throw err
  }
}

export { bundledDataDir }
