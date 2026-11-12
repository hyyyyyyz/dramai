import { ProviderError, toJobError } from '../providers/errors.ts'
import { defaultSleep } from '../providers/executor.ts'
import type { Clock, EventSink, JobRepo } from '../ports/index.ts'
import { recoverRunningJobs } from './recovery.ts'
import type { RecoveryDeps } from './recovery.ts'
import type { Job, JobError, JobId, JobStage, JobType } from './types.ts'

/** 处理器抛这个，可以精确指定失败分类。 */
export class JobFailure extends Error {
  readonly jobError: JobError
  constructor(jobError: JobError) {
    super(jobError.message)
    this.name = 'JobFailure'
    this.jobError = jobError
  }
}

export interface JobCheckpoint {
  providerJobId?: string
  resultUrl?: string
}

export interface JobContext {
  job: Job
  signal: AbortSignal
  /** 重启恢复后设置：从这里续上，不要重新提交。 */
  resume?: 'poll' | 'download'
  setStage(stage: JobStage, progress?: number): Promise<void>
  /** 持久化上游任务号/结果地址。**拿到就立刻调用**，这是“重启后续轮询、绝不重投”的前提。 */
  checkpoint(patch: JobCheckpoint): Promise<void>
}

export interface JobOutcome {
  result?: Record<string, unknown>
}

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome | void>

/** 每条车道的并发。渲染（本地 ffmpeg，峰值内存以 GB 计）固定为 1，不可配置。 */
export const DEFAULT_LANE_LIMITS: Record<JobType, number> = {
  text: 2,
  image: 2,
  video: 3,
  audio: 2,
  render: 1,
}

export interface WorkerDeps {
  jobs: JobRepo
  clock: Clock
  events?: EventSink
  handlers: ReadonlyMap<string, JobHandler> | Record<string, JobHandler>
  lanes?: Partial<Record<JobType, number>>
  /** 轮询间隔（循环空转时），默认 1s。 */
  intervalMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 供“重扫出错那一轮可能留下的 running 任务”使用。 */
  recovery?: Pick<RecoveryDeps, 'listProviderConfigs'>
  onError?: (err: unknown) => void
}

export class JobWorker {
  private readonly handlers: ReadonlyMap<string, JobHandler>
  private readonly limits: Record<JobType, number>
  private readonly active = new Map<JobId, Promise<void>>()
  private stopped = true
  private loop?: Promise<void>
  private ticking?: Promise<void>
  private readonly controller = new AbortController()

  private readonly deps: WorkerDeps

  constructor(deps: WorkerDeps) {
    this.deps = deps
    this.handlers =
      deps.handlers instanceof Map ? deps.handlers : new Map(Object.entries(deps.handlers))
    this.limits = { ...DEFAULT_LANE_LIMITS, ...deps.lanes, render: 1 }
    for (const lane of Object.keys(this.limits) as JobType[]) {
      if (!(this.limits[lane] >= 1)) this.limits[lane] = 1
    }
  }

  laneLimit(lane: JobType): number {
    return this.limits[lane]
  }

  private publish(job: Job | undefined): void {
    if (job) this.deps.events?.emit({ type: 'job.updated', job })
  }

  /**
   * 一轮：按车道容量把排队任务启动起来。不等待任务结束。
   * 同一时刻只会有一轮在跑。
   */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking
    this.ticking = this.doTick().finally(() => {
      this.ticking = undefined
    })
    return this.ticking
  }

  private async doTick(): Promise<void> {
    const [queued, running] = await Promise.all([
      this.deps.jobs.list({ status: 'queued' }),
      this.deps.jobs.list({ status: 'running' }),
    ])
    const used: Record<JobType, number> = { text: 0, image: 0, video: 0, audio: 0, render: 0 }
    for (const j of running) used[j.type]++
    queued.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    for (const job of queued) {
      if (used[job.type] >= this.limits[job.type]) continue
      const now = this.deps.clock.now()
      // 比较并更新：输给 cancel 时拿不到，就跳过。
      const started = await this.deps.jobs.transition(job.id, ['queued'], {
        status: 'running',
        stage:
          job.resumeFrom === 'download'
            ? 'downloading'
            : job.resumeFrom === 'poll'
              ? 'polling'
              : 'submitting',
        startedAt: job.startedAt ?? now,
        updatedAt: now,
        error: undefined,
      })
      if (!started) continue
      used[job.type]++
      this.publish(started)
      const p = this.run(started).finally(() => this.active.delete(started.id))
      this.active.set(started.id, p)
    }
  }

  /** 跑一个任务。任何错误都在这里兜住并落成失败状态，不会逃出去。 */
  private async run(job: Job): Promise<void> {
    const handler = this.handlers.get(job.operation)
    try {
      if (!handler) {
        throw new JobFailure({
          category: 'internal',
          code: 'NO_HANDLER',
          message: `没有注册处理 ${job.operation} 的处理器`,
          recoverable: false,
        })
      }
      const ctx: JobContext = {
        job,
        signal: this.controller.signal,
        resume: job.resumeFrom,
        setStage: async (stage, progress) => {
          const updated = await this.deps.jobs.patch(job.id, {
            stage,
            ...(progress !== undefined ? { progress } : {}),
            updatedAt: this.deps.clock.now(),
          })
          this.publish(updated)
          if (progress !== undefined) {
            this.deps.events?.emit({ type: 'job.progress', jobId: job.id, progress })
          }
        },
        checkpoint: async (patch) => {
          const updated = await this.deps.jobs.patch(job.id, {
            ...patch,
            updatedAt: this.deps.clock.now(),
          })
          this.publish(updated)
        },
      }
      const outcome = await handler(ctx)
      const now = this.deps.clock.now()
      const done = await this.deps.jobs.transition(job.id, ['running'], {
        status: 'succeeded',
        stage: 'completed',
        progress: 1,
        result: outcome?.result,
        error: undefined,
        finishedAt: now,
        updatedAt: now,
      })
      this.publish(done)
    } catch (err) {
      await this.failJob(job.id, err)
    }
  }

  private async failJob(id: JobId, err: unknown): Promise<void> {
    const jobError: JobError =
      err instanceof JobFailure
        ? err.jobError
        : err instanceof ProviderError || err instanceof Error
          ? toJobError(err)
          : toJobError(new Error(String(err)))
    // 取消信号（服务关闭）不算失败：交给下次启动的恢复流程。
    if (err instanceof ProviderError && err.kind === 'cancelled' && this.controller.signal.aborted)
      return
    try {
      const now = this.deps.clock.now()
      let finalError = jobError
      if (finalError.category === 'internal') {
        // 上游任务号/结果地址已经落了检查点：这是“交付失败”，续上原任务是安全的。
        const current = await this.deps.jobs.get(id)
        if (current && (current.providerJobId || current.resultUrl)) {
          finalError = { ...finalError, category: 'delivery_failed', recoverable: true }
        }
      }
      const failed = await this.deps.jobs.transition(id, ['running'], {
        status: 'failed',
        error: finalError,
        finishedAt: now,
        updatedAt: now,
      })
      this.publish(failed)
    } catch (storeErr) {
      // 连“记失败”都失败了：任务会留在 running，由下一轮的 reconcile 处理。
      this.reportError(storeErr)
    }
  }

  private reportError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    this.deps.onError?.(err)
    this.deps.events?.emit({ type: 'job.worker_error', message })
  }

  /** 找出 store 里是 running、但本进程没有在跑的任务（上一轮出错留下的），按重启恢复规则处理。 */
  async reconcileOrphans(): Promise<void> {
    if (!this.deps.recovery) return
    await recoverRunningJobs(
      {
        jobs: this.deps.jobs,
        clock: this.deps.clock,
        events: this.deps.events,
        ...this.deps.recovery,
      },
      { skip: new Set(this.active.keys()) },
    )
  }

  /** 启动循环。单轮出错不会让循环退出：记录、重扫孤儿、按间隔继续。 */
  start(): void {
    if (!this.stopped) return
    this.stopped = false
    const sleep = this.deps.sleep ?? defaultSleep
    const interval = this.deps.intervalMs ?? 1000
    this.loop = (async () => {
      while (!this.stopped) {
        try {
          await this.tick()
        } catch (err) {
          this.reportError(err)
          try {
            await this.reconcileOrphans()
          } catch (err2) {
            this.reportError(err2)
          }
        }
        if (this.stopped) break
        try {
          await sleep(interval, this.controller.signal)
        } catch {
          /* 被 stop 唤醒 */
        }
      }
    })()
  }

  async stop(options: { waitForActive?: boolean } = {}): Promise<void> {
    this.stopped = true
    if (options.waitForActive === false) this.controller.abort()
    await this.loop
    if (options.waitForActive !== false) await Promise.allSettled([...this.active.values()])
  }

  /** 等当前在跑的任务都结束（测试用）。 */
  async idle(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.allSettled([...this.active.values()])
    }
  }

  get runningCount(): number {
    return this.active.size
  }
}
