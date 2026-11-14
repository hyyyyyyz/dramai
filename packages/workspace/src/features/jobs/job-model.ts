import type { JobListItem } from '@dramai/api'

/**
 * 任务面板的语义（DESIGN 4.7、server README、core 的 jobs/queue.ts）：
 * - 排队：只有这时能取消。
 * - 进行中：已提交给服务商，不能取消，已发出的调用会照常跑完、照常计费。
 * - 失败：按失败分类给操作。
 *     · 能续上上游任务（recoverable）→ “恢复原任务”是主操作；
 *     · “重新生成”永远是另一个按钮；可能再次计费时带说明并要求明确确认；
 *     · “我已核对，关闭”只是不再提醒，不改变任务。
 * - 提交结果待确认（submission_unknown）：绝不自动重投，请用户先去服务商后台核对。
 */

export type JobGroup = 'attention' | 'running' | 'queued' | 'recent'

export const RECENT_LIMIT = 5

export function groupJobs(jobs: readonly JobListItem[]): Record<JobGroup, JobListItem[]> {
  const out: Record<JobGroup, JobListItem[]> = {
    attention: [],
    running: [],
    queued: [],
    recent: [],
  }
  for (const j of jobs) {
    if (j.status === 'failed' && j.needsAttention) out.attention.push(j)
    else if (j.status === 'running') out.running.push(j)
    else if (j.status === 'queued') out.queued.push(j)
    else out.recent.push(j)
  }
  const finished = (j: JobListItem) => j.finishedAt ?? j.updatedAt
  out.attention.sort((a, b) => finished(b) - finished(a))
  out.running.sort((a, b) => (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt))
  out.queued.sort(
    (a, b) => (a.queuePosition ?? 1e9) - (b.queuePosition ?? 1e9) || a.createdAt - b.createdAt,
  )
  out.recent.sort((a, b) => finished(b) - finished(a))
  out.recent = out.recent.slice(0, RECENT_LIMIT)
  return out
}

export interface JobCounts {
  running: number
  queued: number
  attention: number
}
export function jobCounts(jobs: readonly JobListItem[]): JobCounts {
  let running = 0
  let queued = 0
  let attention = 0
  for (const j of jobs) {
    if (j.status === 'running') running++
    else if (j.status === 'queued') queued++
    else if (j.status === 'failed' && j.needsAttention) attention++
  }
  return { running, queued, attention }
}

export interface JobActions {
  /** 取消排队（只对排队中的任务）。 */
  cancel: boolean
  /** 恢复原任务：续上已有的上游任务，不重新提交。 */
  resume: boolean
  /** 重新生成。`recharge` 表示可能再次计费，要求确认。 */
  regenerate: false | 'plain' | 'recharge'
  /** 我已核对，关闭。 */
  acknowledge: boolean
  /**
   * 忽略结果（只对运行中的付费任务）：调用照常跑完、照常计费，产物进版本历史，但不自动成为当前版本。
   * `undo` 表示已经标记过，可以取消。
   */
  ignoreResult: false | 'ignore' | 'undo'
}

/** 与 core 的 JobQueue.retry 的判断保持一致：服务端仍会再校验一次（CONFIRM_RECHARGE_REQUIRED）。 */
export function mayRecharge(job: JobListItem): boolean {
  if (!job.paid || job.status !== 'failed') return false
  const category = job.error?.category
  const hasUpstream = Boolean(job.providerJobId || job.resultUrl)
  return category === 'submission_unknown' || (hasUpstream && category !== 'generation_failed')
}

export function jobActions(job: JobListItem): JobActions {
  switch (job.status) {
    case 'queued':
      return {
        cancel: true,
        resume: false,
        regenerate: false,
        acknowledge: false,
        ignoreResult: false,
      }
    case 'failed':
      return {
        cancel: false,
        resume: Boolean(job.error?.recoverable) && job.error?.category !== 'generation_failed',
        regenerate: mayRecharge(job) ? 'recharge' : 'plain',
        acknowledge: job.needsAttention,
        ignoreResult: false,
      }
    case 'running':
      return {
        cancel: false,
        resume: false,
        regenerate: false,
        acknowledge: false,
        ignoreResult: job.paid ? (job.resultIgnored ? 'undo' : 'ignore') : false,
      }
    default:
      return {
        cancel: false,
        resume: false,
        regenerate: false,
        acknowledge: false,
        ignoreResult: false,
      }
  }
}

export type FailureKind =
  | 'generation_failed'
  | 'delivery_failed'
  | 'submission_unknown'
  | 'recovery_failed'
  | 'invalid_input'
  | 'internal'

export function failureKind(job: JobListItem): FailureKind {
  return job.error?.category ?? 'internal'
}

/** 处理器键里已知的操作；其余落到通用标题。 */
export const KNOWN_OPERATIONS = [
  'episodes_plan',
  'episode_breakdown',
  'entities_extract',
  'shot_frames',
  'asset_sheet',
  'shot_image',
  'shot_video',
  'shot_audio',
  'compose',
] as const
export type KnownOperation = (typeof KNOWN_OPERATIONS)[number]
export const isKnownOperation = (op: string): op is KnownOperation =>
  (KNOWN_OPERATIONS as readonly string[]).includes(op)

/** The inputs a finished job did not use (`result.ignoredInputs`): fields it was given that the model doesn't take. */
export function ignoredInputsOf(result: Record<string, unknown> | undefined): string[] {
  const v = result?.ignoredInputs
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
