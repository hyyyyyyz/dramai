import { useCall } from '@/data/queries'
import { qk } from '@/data/keys'

/** 任务的四个操作。成功后服务端会推 job.updated，这里再主动失效一次任务列表以立刻反映。 */
export function useJobActions() {
  const opts = { invalidate: [qk.jobs] }
  return {
    cancel: useCall('jobs.cancel', opts),
    resume: useCall('jobs.resume', opts),
    retry: useCall('jobs.retry', opts),
    acknowledge: useCall('jobs.acknowledge', opts),
    ignoreResult: useCall('jobs.ignoreResult', opts),
  }
}
