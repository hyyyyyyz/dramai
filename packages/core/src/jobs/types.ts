import type { AssetId, JobId, ProjectId, ShotId } from '../domain/common.ts'
import type { ProviderSnapshot } from '../domain/media.ts'

export type { JobId }

/**
 * 任务（A5）。实体就叫 Job。
 *
 * `type` 同时是并发车道：text / image / video / audio 各自独立，render（本地 ffmpeg）
 * 全局并发固定为 1。状态（status）与阶段（stage）是两个独立字段。
 */
export type JobType = 'text' | 'image' | 'video' | 'audio' | 'render'
export const JOB_TYPES: readonly JobType[] = ['text', 'image', 'video', 'audio', 'render']

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 仅在 running 时有意义。 */
export type JobStage =
  | 'submitting'
  | 'polling'
  | 'transferring'
  | 'downloading'
  | 'processing'
  | 'completed'

/**
 * 失败分类：
 * - generation_failed：上游确认生成失败。不可恢复，重试 = 重新生成（会再次计费）。
 * - delivery_failed：上游已生成成功，但交付（轮询耗尽/下载/写盘）失败。可恢复：续上原任务。
 * - submission_unknown：提交结果不明（请求可能已送达并计费）。**绝不自动重投**，交用户决定。
 * - recovery_failed：重启后无法按原配置恢复。
 * - invalid_input：准入之外的输入问题（文件读不到等），未发起付费调用。
 * - internal：其他内部错误。
 */
export type FailureCategory =
  | 'generation_failed'
  | 'delivery_failed'
  | 'submission_unknown'
  | 'recovery_failed'
  | 'invalid_input'
  | 'internal'

export interface JobError {
  category: FailureCategory
  /** 稳定的机器可读码，例如 `HTTP_500`、`UPSTREAM_FAILED`。 */
  code: string
  message: string
  /** 能否续上原上游任务（有 providerJobId / resultUrl 且上游没确认失败）。 */
  recoverable: boolean
}

export interface Job {
  schemaVersion: number
  id: JobId
  /** 车道。 */
  type: JobType
  /** 处理器键，例如 `shot_image`、`shot_video`、`storyboard`、`compose`。 */
  operation: string
  projectId: ProjectId
  shotId?: ShotId
  assetId?: AssetId
  episodeId?: string
  /** 所属批量任务。 */
  batchId?: string
  /** 同一目标 + 同一输入指纹的在途任务去重（原子，见 `JobRepo.insertIfNoConflict`）。 */
  dedupeKey?: string
  /** 互斥键：同一时刻只允许一个在途任务（如同一镜头的视频）。输入不同也冲突。 */
  exclusiveKey?: string
  /** 给人看的服务商名（任务面板用）。 */
  providerLabel?: string
  /** 提交时冻结的服务商配置；重启恢复只认它。 */
  providerSnapshot?: ProviderSnapshot
  /** 处理器自己的参数（JSON）。 */
  params: Record<string, unknown>
  /** 会产生费用的任务。无 providerJobId 的付费任务在重启后绝不自动重投。 */
  paid: boolean

  status: JobStatus
  stage?: JobStage
  /** 0..1。 */
  progress?: number
  /** 第几次尝试，从 1 起；retry 时递增。 */
  attempt: number

  /** 上游任务号：拿到后立刻写入（检查点）。 */
  providerJobId?: string
  /** 上游已给出结果地址（可能是签名链接，过期则用 providerJobId 重新查询）。 */
  resultUrl?: string
  /** 历史尝试里出现过的上游任务号，保留对账线索。 */
  previousProviderJobIds: string[]
  /** 产出物（处理器写入，例如新建的版本 id）。 */
  result?: Record<string, unknown>
  /** 重启恢复后设置：处理器应从这里续上，而不是重新提交。 */
  resumeFrom?: 'poll' | 'download'

  error?: JobError
  /**
   * 用户已知悉（“我已核对，关闭”）的时间。失败 / 提交结果待确认的任务被用户处理后标记，之后不再提醒。
   * 只是一个提醒开关：不改变任务状态，也不影响重试 / 恢复原任务。重试或恢复会清掉它（新的失败要重新提醒）。
   */
  acknowledgedAt?: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
  updatedAt: number
}

/** 合法的状态转移表。 */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'queued'], // running → queued 仅用于重启恢复（续轮询/无费用任务重排）
  succeeded: [],
  failed: ['queued'], // 用户重试 / 恢复原任务
  cancelled: [],
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'cancelled'
}

/** 需要用户处理的任务：失败且还没被“已知悉”。任务面板的“需处理”一组。 */
export function needsAttention(job: Pick<Job, 'status' | 'acknowledgedAt'>): boolean {
  return job.status === 'failed' && job.acknowledgedAt === undefined
}

export function isInFlight(status: JobStatus): boolean {
  return status === 'queued' || status === 'running'
}

/** 排队任务在各自车道里的位置（从 1 起）。 */
export function queuePositions(jobs: Job[]): Map<JobId, number> {
  const out = new Map<JobId, number>()
  const perLane = new Map<JobType, Job[]>()
  for (const job of jobs) {
    if (job.status !== 'queued') continue
    const list = perLane.get(job.type) ?? []
    list.push(job)
    perLane.set(job.type, list)
  }
  for (const list of perLane.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    list.forEach((job, i) => out.set(job.id, i + 1))
  }
  return out
}
