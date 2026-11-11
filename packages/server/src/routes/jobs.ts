import { jobStatus } from '@dramai/api'
import type { JobStatus } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { badRequest, conflict, notFound } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import { jobView, jobViews } from '../services/job-views.ts'
import { registerGenerateRoutes } from './generate.ts'
import { registerImportRoutes } from './import.ts'

type Failure = { ok: false; reason: string; message?: string }

const MESSAGES: Record<string, string> = {
  RUNNING_NOT_CANCELLABLE:
    '任务已经在运行：已发往服务商的调用无法撤回，会照常跑完并产出结果。等它结束即可。',
  ALREADY_FINISHED: '任务已经结束，无需取消。',
  NOT_FAILED: '只有失败的任务才能这样操作。',
  NOTHING_TO_RESUME: '这个任务没有可续接的上游任务（或上游已确认失败），请直接重新生成。',
  CONFIRM_RECHARGE_REQUIRED: '重新生成可能再次计费，需要确认。',
  NOT_RUNNING: '任务还在排队，没有花钱：直接取消即可，不需要“忽略结果”。',
  NOT_APPLICABLE: '只有生成图片 / 视频 / 配音的付费任务才有“忽略结果”。',
}

/** 把队列的失败结果翻成 HTTP：不存在 → 404；状态不允许 → 409（稳定错误码，前端据此给出下一步）。 */
function fail(jobId: string, result: Failure): never {
  if (result.reason === 'NOT_FOUND') throw notFound('任务', jobId)
  throw conflict(result.reason, result.message ?? MESSAGES[result.reason] ?? result.reason, {
    jobId,
    ...(result.reason === 'CONFIRM_RECHARGE_REQUIRED' ? { requires: 'confirmRecharge' } : {}),
  })
}

const STATUSES = new Set<string>(jobStatus.options)

export function registerJobRoutes(r: RouteRegistry, ctx: ServerContext): void {
  registerGenerateRoutes(r, ctx)
  registerImportRoutes(r, ctx)

  r.handle('jobs.list', async ({ query }) => {
    let status: JobStatus[] | undefined
    if (query.status) {
      status = query.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as JobStatus[]
      const bad = status.find((s) => !STATUSES.has(s))
      if (bad) throw badRequest(`未知的任务状态：${bad}`)
    }
    const jobs = await ctx.queue.list({ projectId: query.projectId, status })
    const items = await jobViews(ctx, jobs)
    const filtered =
      query.needsAttention === undefined
        ? items
        : items.filter((j) => j.needsAttention === query.needsAttention)
    // 最新的在前；limit 取最新的 N 条。
    filtered.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
    return { items: query.limit ? filtered.slice(0, query.limit) : filtered }
  })

  r.handle('jobs.get', async ({ params }) => {
    const job = await ctx.queue.get(params.jobId)
    if (!job) throw notFound('任务', params.jobId)
    return jobView(ctx, job)
  })

  r.handle('jobs.cancel', async ({ params }) => {
    const res = await ctx.queue.cancel(params.jobId)
    if (!res.ok) fail(params.jobId, res)
    return jobView(ctx, res.job)
  })

  r.handle('jobs.retry', async ({ params, body }) => {
    const res = await ctx.queue.retry(params.jobId, { confirmRecharge: body.confirmRecharge })
    if (!res.ok) fail(params.jobId, res)
    return jobView(ctx, res.job)
  })

  r.handle('jobs.resume', async ({ params }) => {
    const res = await ctx.queue.resume(params.jobId)
    if (!res.ok) fail(params.jobId, res)
    return jobView(ctx, res.job)
  })

  r.handle('jobs.acknowledge', async ({ params }) => {
    const res = await ctx.queue.acknowledge(params.jobId)
    if (!res.ok) fail(params.jobId, res)
    return jobView(ctx, res.job)
  })

  r.handle('jobs.ignoreResult', async ({ params, body }) => {
    const res = await ctx.queue.ignoreResult(params.jobId, body.ignore ?? true)
    if (!res.ok) fail(params.jobId, res)
    return jobView(ctx, res.job)
  })
}
