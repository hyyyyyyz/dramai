import type { Clock, EventSink, JobRepo } from '../ports/index.ts'
import { SYNC_PROTOCOLS } from '../providers/types.ts'
import type { ProtocolId, ProviderConfig } from '../providers/types.ts'
import type { Job, JobError, JobId } from './types.ts'

/**
 * 重启恢复（A5）。
 *
 * 扫描状态为 running 的任务（进程崩溃/重启时它们没有结局）：
 * - 有上游任务号（或已有结果地址）→ 按**提交时冻结的服务商配置**恢复：写回 queued 并标记 resumeFrom，
 *   由处理器续轮询/续下载。配置不存在或 协议/baseUrl 与提交时不一致 → 失败为 recovery_failed，
 *   **绝不换服务商查询**。
 * - 没有上游任务号 → 付费任务标记 submission_unknown，**绝不自动重投**（按次计费：一次恢复可能把几十个
 *   任务重复扣费）；不花钱的任务（如本地渲染）直接重新排队。
 */

export type ProviderCheck = { ok: true } | { ok: false; message: string }

const norm = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()

/** 校验任务冻结的服务商快照仍然对得上现有配置。 */
export function checkProviderSnapshot(job: Job, configs: readonly ProviderConfig[]): ProviderCheck {
  const snap = job.providerSnapshot
  if (!snap) return { ok: false, message: '任务没有记录提交时的服务商配置，无法确认该向谁查询' }
  if (snap.providerConfigId) {
    const cfg = configs.find((c) => c.id === snap.providerConfigId)
    if (!cfg) return { ok: false, message: `提交时的服务商配置 ${snap.providerConfigId} 已不存在` }
    if (cfg.protocol !== snap.protocol || norm(cfg.baseUrl) !== norm(snap.baseUrl)) {
      return {
        ok: false,
        message: `服务商配置 ${cfg.label} 的协议或地址与提交时不一致，不会换服务商查询`,
      }
    }
    return { ok: true }
  }
  // 旧任务没有配置记录：只在同协议同地址恰好一个启用配置时恢复。
  const same = configs.filter(
    (c) => c.enabled && c.protocol === snap.protocol && norm(c.baseUrl) === norm(snap.baseUrl),
  )
  if (same.length === 1) return { ok: true }
  return {
    ok: false,
    message:
      same.length === 0
        ? '找不到与提交时一致的服务商配置'
        : '有多个同类服务商配置，无法确定该向谁查询',
  }
}

export interface RecoveryDeps {
  jobs: JobRepo
  clock: Clock
  events?: EventSink
  /** 当前所有服务商配置。 */
  listProviderConfigs: () => Promise<readonly ProviderConfig[]>
}

export interface RecoveryReport {
  resumed: JobId[]
  unknown: JobId[]
  requeued: JobId[]
  failed: JobId[]
}

export async function recoverRunningJobs(
  deps: RecoveryDeps,
  options: { skip?: ReadonlySet<JobId> } = {},
): Promise<RecoveryReport> {
  const report: RecoveryReport = { resumed: [], unknown: [], requeued: [], failed: [] }
  const running = await deps.jobs.list({ status: 'running' })
  const configs = await deps.listProviderConfigs()
  for (const job of running) {
    if (options.skip?.has(job.id)) continue
    const now = deps.clock.now()
    const hasUpstream = Boolean(job.providerJobId || job.resultUrl)

    if (hasUpstream) {
      const check = checkProviderSnapshot(job, configs)
      if (check.ok) {
        const updated = await deps.jobs.transition(job.id, ['running'], {
          status: 'queued',
          stage: undefined,
          resumeFrom: job.resultUrl ? 'download' : 'poll',
          updatedAt: now,
        })
        if (updated) {
          report.resumed.push(job.id)
          deps.events?.emit({ type: 'job.updated', job: updated })
        }
      } else {
        await fail(deps, job, now, {
          category: 'recovery_failed',
          code: 'PROVIDER_MISMATCH',
          message: check.message,
          recoverable: false,
        })
        report.failed.push(job.id)
      }
      continue
    }

    if (job.paid) {
      const sync =
        job.providerSnapshot && SYNC_PROTOCOLS.includes(job.providerSnapshot.protocol as ProtocolId)
      await fail(deps, job, now, {
        category: 'submission_unknown',
        code: sync ? 'SYNC_CALL_INTERRUPTED' : 'SUBMISSION_UNKNOWN',
        message: sync
          ? '该服务商的接口是同步返回结果的，没有任务号可查：服务重启时这次调用被中断，结果已经丢失，但服务商可能已经计费。请到服务商后台的用量 / 账单里按时间核对这次调用，确认后再决定是否重新生成；为避免重复扣费不会自动重试。'
          : '服务重启时该任务还没有拿到上游任务号：请求可能已被服务商受理并计费。为避免重复扣费不会自动重新提交，请到服务商后台核对后再决定是否重试。',
        recoverable: false,
      })
      report.unknown.push(job.id)
    } else {
      const updated = await deps.jobs.transition(job.id, ['running'], {
        status: 'queued',
        stage: undefined,
        updatedAt: now,
      })
      if (updated) {
        report.requeued.push(job.id)
        deps.events?.emit({ type: 'job.updated', job: updated })
      }
    }
  }
  return report
}

async function fail(deps: RecoveryDeps, job: Job, now: number, error: JobError): Promise<void> {
  const updated = await deps.jobs.transition(job.id, ['running'], {
    status: 'failed',
    error,
    finishedAt: now,
    updatedAt: now,
  })
  if (updated) deps.events?.emit({ type: 'job.updated', job: updated })
}
