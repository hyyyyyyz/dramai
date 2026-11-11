import { SCHEMA_VERSIONS } from '../domain/common.ts'
import type { ProviderSnapshot } from '../domain/media.ts'
import type { Clock, EventSink, IdGenerator, JobFilter, JobRepo } from '../ports/index.ts'
import { isInFlight, queuePositions } from './types.ts'
import type { Job, JobId, JobType } from './types.ts'

export interface NewJob {
  type: JobType
  operation: string
  projectId: string
  shotId?: string
  assetId?: string
  episodeId?: string
  batchId?: string
  dedupeKey?: string
  exclusiveKey?: string
  providerLabel?: string
  providerSnapshot?: ProviderSnapshot
  params?: Record<string, unknown>
  /** 缺省：除 render 外都算付费。 */
  paid?: boolean
}

export interface QueueDeps {
  jobs: JobRepo
  clock: Clock
  ids: IdGenerator
  events?: EventSink
}

/** 同一互斥键（如同一镜头的视频）已有在途任务。 */
export class InFlightConflictError extends Error {
  readonly existing: Job
  constructor(existing: Job) {
    super(`an in-flight job already holds this slot: ${existing.id}`)
    this.name = 'InFlightConflictError'
    this.existing = existing
  }
}

export type CancelResult =
  | { ok: true; job: Job }
  | { ok: false; reason: 'NOT_FOUND' | 'RUNNING_NOT_CANCELLABLE' | 'ALREADY_FINISHED' }

export type RetryResult =
  | { ok: true; job: Job }
  | {
      ok: false
      reason: 'NOT_FOUND' | 'NOT_FAILED' | 'CONFIRM_RECHARGE_REQUIRED'
      message?: string
    }

export type AcknowledgeResult =
  | { ok: true; job: Job; alreadyAcknowledged: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_FAILED' }

export type ResumeResult =
  | { ok: true; job: Job }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_FAILED' | 'NOTHING_TO_RESUME' }

/**
 * 任务队列（入队/取消/重试/恢复原任务）。执行在 JobWorker 里。
 *
 * 语义（A5）：
 * - 取消**只作用于排队中**的任务。已发出的上游调用照常跑完，结果照常成为产物；
 *   对运行中任务只能"忽略结果"（不在这里处理）。
 * - 重试 = 新一次尝试。失败的任务若带上游任务号，必须先"恢复原任务"（resume）；
 *   坚持重新生成需要显式确认"可能再次计费"。提交结果不明的任务同理。
 */
export class JobQueue {
  private readonly deps: QueueDeps

  constructor(deps: QueueDeps) {
    this.deps = deps
  }

  private publish(job: Job): void {
    this.deps.events?.emit({ type: 'job.updated', job })
  }

  /**
   * 入队。去重与互斥由 `JobRepo.insertIfNoConflict` 原子保证（并发的双击、两个标签页不会各建一个付费任务）：
   * - 同一 dedupeKey 的在途任务已存在 → 返回它，`deduped: true`；
   * - 同一 exclusiveKey 的在途任务已存在（输入不同）→ 抛 `InFlightConflictError`。
   */
  async enqueue(input: NewJob): Promise<{ job: Job; deduped: boolean }> {
    const now = this.deps.clock.now()
    const job: Job = {
      schemaVersion: SCHEMA_VERSIONS.job,
      id: this.deps.ids.next('job'),
      type: input.type,
      operation: input.operation,
      projectId: input.projectId,
      shotId: input.shotId,
      assetId: input.assetId,
      episodeId: input.episodeId,
      batchId: input.batchId,
      dedupeKey: input.dedupeKey,
      exclusiveKey: input.exclusiveKey,
      providerLabel: input.providerLabel,
      providerSnapshot: input.providerSnapshot,
      params: input.params ?? {},
      paid: input.paid ?? input.type !== 'render',
      status: 'queued',
      attempt: 1,
      previousProviderJobIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const res = await this.deps.jobs.insertIfNoConflict(job)
    if (res.inserted) {
      this.publish(res.job)
      return { job: res.job, deduped: false }
    }
    if (res.conflict === 'dedupe') return { job: res.existing, deduped: true }
    throw new InFlightConflictError(res.existing)
  }

  async get(id: JobId): Promise<Job | undefined> {
    return this.deps.jobs.get(id)
  }

  /** 列表，附排队位置。 */
  async list(filter?: JobFilter): Promise<Array<Job & { queuePosition?: number }>> {
    const [jobs, queued] = await Promise.all([
      this.deps.jobs.list(filter),
      this.deps.jobs.list({ status: 'queued' }),
    ])
    const pos = queuePositions(queued)
    return jobs.map((j) => ({ ...j, queuePosition: pos.get(j.id) }))
  }

  async cancel(id: JobId): Promise<CancelResult> {
    const job = await this.deps.jobs.get(id)
    if (!job) return { ok: false, reason: 'NOT_FOUND' }
    if (job.status === 'running') return { ok: false, reason: 'RUNNING_NOT_CANCELLABLE' }
    if (job.status !== 'queued') return { ok: false, reason: 'ALREADY_FINISHED' }
    const now = this.deps.clock.now()
    // 与 worker 启动竞争：用比较并更新，输了就说明它刚刚开始运行。
    const updated = await this.deps.jobs.transition(id, ['queued'], {
      status: 'cancelled',
      finishedAt: now,
      updatedAt: now,
    })
    if (!updated) return { ok: false, reason: 'RUNNING_NOT_CANCELLABLE' }
    this.publish(updated)
    return { ok: true, job: updated }
  }

  /** 重新生成：新一次尝试。可能再次计费的情形需要 `confirmRecharge`。 */
  async retry(id: JobId, options: { confirmRecharge?: boolean } = {}): Promise<RetryResult> {
    const job = await this.deps.jobs.get(id)
    if (!job) return { ok: false, reason: 'NOT_FOUND' }
    if (job.status !== 'failed') return { ok: false, reason: 'NOT_FAILED' }

    const hasUpstream = Boolean(job.providerJobId || job.resultUrl)
    const category = job.error?.category
    const mayRecharge =
      job.paid &&
      (category === 'submission_unknown' || (hasUpstream && category !== 'generation_failed'))
    if (mayRecharge && !options.confirmRecharge) {
      return {
        ok: false,
        reason: 'CONFIRM_RECHARGE_REQUIRED',
        message: hasUpstream
          ? '该任务已有上游任务号，请先“恢复原任务”；坚持重新生成可能再次计费，需要确认。'
          : '该任务的提交结果不明（上游可能已受理并计费），重新生成可能再次计费，需要确认；建议先到服务商后台核对。',
      }
    }
    const now = this.deps.clock.now()
    const previous = job.providerJobId
      ? [...job.previousProviderJobIds, job.providerJobId]
      : job.previousProviderJobIds
    const updated = await this.deps.jobs.transition(id, ['failed'], {
      status: 'queued',
      stage: undefined,
      progress: undefined,
      error: undefined,
      acknowledgedAt: undefined,
      providerJobId: undefined,
      resultUrl: undefined,
      resumeFrom: undefined,
      result: undefined,
      previousProviderJobIds: previous,
      attempt: job.attempt + 1,
      startedAt: undefined,
      finishedAt: undefined,
      updatedAt: now,
    })
    if (!updated) return { ok: false, reason: 'NOT_FAILED' }
    this.publish(updated)
    return { ok: true, job: updated }
  }

  /**
   * 标记“已知悉”：失败或“提交结果待确认”的任务被用户处理后，不再提醒。
   * 只对失败的任务有意义；重复标记是幂等的。
   */
  async acknowledge(id: JobId): Promise<AcknowledgeResult> {
    const job = await this.deps.jobs.get(id)
    if (!job) return { ok: false, reason: 'NOT_FOUND' }
    if (job.status !== 'failed') return { ok: false, reason: 'NOT_FAILED' }
    if (job.acknowledgedAt !== undefined) return { ok: true, job, alreadyAcknowledged: true }
    const now = this.deps.clock.now()
    const updated = await this.deps.jobs.transition(id, ['failed'], {
      acknowledgedAt: now,
      updatedAt: now,
    })
    if (!updated) return { ok: false, reason: 'NOT_FAILED' }
    this.publish(updated)
    return { ok: true, job: updated, alreadyAcknowledged: false }
  }

  /** 恢复原任务：续上已有的上游任务号/结果地址，不重新提交。 */
  async resume(id: JobId): Promise<ResumeResult> {
    const job = await this.deps.jobs.get(id)
    if (!job) return { ok: false, reason: 'NOT_FOUND' }
    if (job.status !== 'failed') return { ok: false, reason: 'NOT_FAILED' }
    if (!job.providerJobId && !job.resultUrl) return { ok: false, reason: 'NOTHING_TO_RESUME' }
    if (job.error?.category === 'generation_failed')
      return { ok: false, reason: 'NOTHING_TO_RESUME' }
    const now = this.deps.clock.now()
    const updated = await this.deps.jobs.transition(id, ['failed'], {
      status: 'queued',
      stage: undefined,
      error: undefined,
      acknowledgedAt: undefined,
      resumeFrom: job.resultUrl ? 'download' : 'poll',
      finishedAt: undefined,
      updatedAt: now,
    })
    if (!updated) return { ok: false, reason: 'NOT_FAILED' }
    this.publish(updated)
    return { ok: true, job: updated }
  }

  inFlight(jobs: Job[]): Job[] {
    return jobs.filter((j) => isInFlight(j.status))
  }
}
