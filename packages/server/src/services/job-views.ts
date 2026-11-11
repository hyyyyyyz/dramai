import type { JobListItem } from '@dramai/api'
import { needsAttention, queuePositions } from '@dramai/core'
import type { Job } from '@dramai/core'
import type { ServerContext } from '../context.ts'

export function toJobItem(job: Job, queuePosition?: number): JobListItem {
  return {
    ...job,
    ...(queuePosition === undefined ? {} : { queuePosition }),
    needsAttention: needsAttention(job),
  } as JobListItem
}

/** 单个任务的视图（排队中的带排队位置）。 */
export async function jobView(ctx: ServerContext, job: Job): Promise<JobListItem> {
  if (job.status !== 'queued') return toJobItem(job)
  const queued = await ctx.store.jobs.list({ status: 'queued' })
  return toJobItem(job, queuePositions(queued).get(job.id))
}
