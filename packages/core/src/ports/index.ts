import type {
  Material,
  TimelineDocument,
  Asset,
  AssetId,
  EntityCandidate,
  Episode,
  EpisodeId,
  Project,
  ProjectId,
  Scene,
  SceneId,
  Shot,
  ShotAssetRef,
  ShotId,
} from '../domain/index.ts'
import type { ArtifactRecord } from '../artifacts/types.ts'
import type { Job, JobId, JobStatus } from '../jobs/types.ts'

/**
 * 端口（ports）：core 只依赖这些接口，不碰 SQLite、文件系统路径布局、HTTP 框架。
 * server 在 2C 实现它们；内存实现在 `@dramai/core/testing`，供测试使用。
 *
 * 仓库接口是 async 的（SQLite 同步实现也只是返回已完成的 Promise）。
 */

export interface Clock {
  now(): number
}

export interface IdGenerator {
  /** 发一个全局唯一、永不复用的 id，带可读前缀，如 `shot_8f3k2a`。 */
  next(prefix: string): string
}

export interface ProjectRepo {
  get(id: ProjectId): Promise<Project | undefined>
  put(project: Project): Promise<void>
  list(options?: { includeDeleted?: boolean }): Promise<Project[]>
  /** 物理删除（回收目录的清理由 server 负责）。 */
  delete(id: ProjectId): Promise<void>
}

export interface EpisodeRepo {
  get(id: EpisodeId): Promise<Episode | undefined>
  put(episode: Episode): Promise<void>
  listByProject(projectId: ProjectId): Promise<Episode[]>
  delete(id: EpisodeId): Promise<void>
}

export interface SceneRepo {
  get(id: SceneId): Promise<Scene | undefined>
  put(scene: Scene): Promise<void>
  listByProject(projectId: ProjectId): Promise<Scene[]>
  delete(id: SceneId): Promise<void>
}

export interface ShotRepo {
  get(id: ShotId): Promise<Shot | undefined>
  put(shot: Shot): Promise<void>
  listByProject(projectId: ProjectId): Promise<Shot[]>
  delete(id: ShotId): Promise<void>
}

export interface AssetRepo {
  get(id: AssetId): Promise<Asset | undefined>
  put(asset: Asset): Promise<void>
  listByProject(projectId: ProjectId, options?: { includeDeleted?: boolean }): Promise<Asset[]>
  delete(id: AssetId): Promise<void>
}

export interface ShotAssetRefRepo {
  listByShot(shotId: ShotId): Promise<ShotAssetRef[]>
  listByProject(projectId: ProjectId): Promise<ShotAssetRef[]>
  /** 整体替换某个镜头的引用。 */
  replaceForShot(shotId: ShotId, refs: ShotAssetRef[]): Promise<void>
}

export interface CandidateRepo {
  get(id: string): Promise<EntityCandidate | undefined>
  put(candidate: EntityCandidate): Promise<void>
  listByProject(projectId: ProjectId): Promise<EntityCandidate[]>
  delete(id: string): Promise<void>
}

export interface MaterialRepo {
  get(id: string): Promise<Material | undefined>
  put(material: Material): Promise<void>
  listByProject(projectId: ProjectId): Promise<Material[]>
  delete(id: string): Promise<void>
}

export interface TimelineRepo {
  get(id: string): Promise<TimelineDocument | undefined>
  put(doc: TimelineDocument): Promise<void>
  listByProject(projectId: ProjectId): Promise<TimelineDocument[]>
  delete(id: string): Promise<void>
}

export interface ArtifactRepo {
  get(projectId: ProjectId, key: string): Promise<ArtifactRecord | undefined>
  put(record: ArtifactRecord): Promise<void>
  listByProject(projectId: ProjectId): Promise<ArtifactRecord[]>
  delete(projectId: ProjectId, key: string): Promise<void>
}

export interface JobFilter {
  projectId?: ProjectId
  status?: JobStatus | JobStatus[]
  shotId?: ShotId
  batchId?: string
}

/** 原子插入的结果。 */
export type InsertJobResult =
  | { inserted: true; job: Job }
  | {
      inserted: false
      /** 已存在的在途任务。 */
      existing: Job
      /**
       * dedupe：同一 `dedupeKey`（同一目标 + 同一输入）已有在途任务——调用方应直接复用它。
       * exclusive：同一 `exclusiveKey`（如“同一镜头的视频”）已有在途任务，但输入不同——调用方应报冲突。
       */
      conflict: 'dedupe' | 'exclusive'
    }

export interface JobRepo {
  /**
   * **原子的**“没有在途冲突才插入”。契约（所有实现必须满足，可用 `checkJobRepoContract` 验证）：
   * - 同一项目内，若已存在状态为 queued / running 的任务，其 `dedupeKey` 与新任务相同 → 不插入，返回
   *   `{ inserted: false, conflict: 'dedupe', existing }`；
   * - 否则若其 `exclusiveKey` 与新任务相同 → 不插入，返回 `conflict: 'exclusive'`；
   * - 否则插入。检查与插入之间不得被其他调用穿插：并发的 N 次调用最多只有一次插入成功。
   * SQLite 实现：两个“仅在途”的部分唯一索引（dedupe_key、exclusive_key，条件 status IN ('queued','running')）
   * 加冲突后回查；或把检查与插入放进一个 IMMEDIATE 事务。
   * 没有这两个 key 的任务总是插入成功。
   */
  insertIfNoConflict(job: Job): Promise<InsertJobResult>
  /** 无检查的插入（测试 / 导入用）。id 重复抛错。 */
  insert(job: Job): Promise<void>
  get(id: JobId): Promise<Job | undefined>
  /**
   * 原子的"比较并更新"：只有当前状态在 `from` 里才应用 `patch`，返回更新后的任务；
   * 否则返回 undefined（例如取消与启动的竞争）。
   */
  transition(id: JobId, from: JobStatus[], patch: Partial<Job>): Promise<Job | undefined>
  /** 无条件部分更新（运行中的检查点写入）。任务不存在时返回 undefined。 */
  patch(id: JobId, patch: Partial<Job>): Promise<Job | undefined>
  list(filter?: JobFilter): Promise<Job[]>
}

/** 所有仓库的集合。`transaction` 内的所有写入要么全部生效要么全部不生效。 */
export interface Store {
  projects: ProjectRepo
  episodes: EpisodeRepo
  scenes: SceneRepo
  shots: ShotRepo
  assets: AssetRepo
  shotRefs: ShotAssetRefRepo
  candidates: CandidateRepo
  materials: MaterialRepo
  timelines: TimelineRepo
  artifacts: ArtifactRepo
  jobs: JobRepo
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>
}

export interface FileInfo {
  bytes: number
  sha256: string
}

/** 项目文件夹的读写。路径是相对项目目录的相对路径，用 "/" 分隔。 */
export interface FileStore {
  put(projectId: ProjectId, path: string, data: Uint8Array): Promise<FileInfo>
  get(projectId: ProjectId, path: string): Promise<Uint8Array>
  exists(projectId: ProjectId, path: string): Promise<boolean>
  remove(projectId: ProjectId, path: string): Promise<void>
  /** 本机绝对路径，给 ffmpeg 等外部进程用。文件必须已存在。 */
  localPath(projectId: ProjectId, path: string): Promise<string>
}

/** API Key 等机密。引用是不透明字符串；值只在调用时取出，传给适配器作参数，不进环境变量。 */
export interface SecretStore {
  get(ref: string): Promise<string | undefined>
  set(ref: string, value: string): Promise<void>
  delete(ref: string): Promise<void>
  has(ref: string): Promise<boolean>
}

export type CoreEvent =
  | { type: 'job.updated'; job: Job }
  | { type: 'job.progress'; jobId: JobId; progress: number; message?: string }
  | { type: 'job.worker_error'; message: string }
  | { type: 'artifact.changed'; projectId: ProjectId; key: string }
  | { type: 'project.changed'; projectId: ProjectId }
  /** 时间线被后台自动改了一个修订（如第一份生成的视频到了，片段原声默认音量跟着定下来）。 */
  | { type: 'timeline.changed'; projectId: ProjectId; episodeId: string }
  /**
   * **提示，不是失败**：任务本身的结果是对的（例如视频已经保存），只是某个附带步骤没有完成。
   * 客户端不得把它显示成“任务失败”或“执行器出错”（那是 `job.worker_error`）。`code` 是稳定的机器可读码。
   */
  | {
      type: 'job.notice'
      level: 'info' | 'warning'
      code: string
      message: string
      projectId: ProjectId
      jobId?: JobId
      shotId?: string
    }

export interface EventSink {
  emit(event: CoreEvent): void
}
