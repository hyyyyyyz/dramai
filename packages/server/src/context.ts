import type {
  Catalog,
  Clock,
  FfmpegCapabilities,
  FfmpegBinaries,
  IdGenerator,
  JobQueue,
  JobWorker,
  PipelineDeps,
  ProviderConfig,
  ProviderKind,
  SecretStore,
} from '@dramai/core'
import type { EventBus } from './events/event-bus.ts'
import type { SettingsService } from './services/settings.ts'
import type { ProviderService } from './services/providers.ts'
import type { FsFileStore } from './storage/files.ts'
import type { ServerStore } from './storage/sqlite-store.ts'

export interface ServerConfig {
  dataDir: string
  host: string
  /** 实际监听端口（listen 之后才知道，之前是 0）。 */
  port: number
  version: string
  desktop: boolean
  startedAt: number
  tokenRequired: boolean
  /** 演示模式（由演示入口传入）；正式启动路径不设。 */
  demo?: { notice: string }
}

export interface FfmpegState {
  bins?: FfmpegBinaries
  caps?: FfmpegCapabilities
  /** 找不到 / 探测失败的原因。 */
  error?: string
}

/** 路由模块共用的运行时。所有服务都挂在这里，路由不自己 new 东西。 */
export interface ServerContext {
  config: ServerConfig
  store: ServerStore
  files: FsFileStore
  secrets: SecretStore
  bus: EventBus
  clock: Clock
  ids: IdGenerator
  catalog: Catalog
  /** 传给 core 流水线的依赖（和 worker 用的是同一份）。 */
  deps: PipelineDeps
  queue: JobQueue
  worker: JobWorker
  ffmpeg: FfmpegState
  settings: SettingsService
  providers: ProviderService
  /** 当前选中的某类服务商配置（未选或已停用 → undefined）。 */
  activeProvider(kind: ProviderKind): Promise<ProviderConfig | undefined>
}
